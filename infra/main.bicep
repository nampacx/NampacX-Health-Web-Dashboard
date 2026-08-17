// Provisions the Withings token broker: a Flex Consumption Function App
// (Node 22, Linux, scale-to-zero), its storage account, Application Insights,
// and the Key Vault holding the Withings client secret. Deploy with `azd up`
// from the repo root.
targetScope = 'resourceGroup'

@description('Environment name, used to derive resource names (azd sets this automatically).')
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Withings OAuth client ID. Public by design, same posture as the SPA client IDs.')
param withingsClientId string

@secure()
@description('Withings OAuth client secret. Never logged, never sent to the SPA.')
param withingsClientSecret string

@description('Comma-separated browser origins allowed to call the broker.')
param allowedOrigins string = 'https://mikokono.de,http://localhost:5173,http://127.0.0.1:5173'

@description('Comma-separated redirect URIs the /exchange route will accept.')
param allowedRedirectUris string = 'https://mikokono.de/Google-Health-Web-Dashboard/'

var resourceToken = uniqueString(subscription().id, resourceGroup().id, environmentName)

// One convention for everything this template creates: <type>-<namePrefix>-<token>.
// `ghd` abbreviates Google Health Dashboard, `withings` scopes this to the broker.
// Declared once so the convention can't drift resource by resource.
var namePrefix = 'ghd-withings'
var functionAppName = 'func-${namePrefix}-${resourceToken}'
var appServicePlanName = 'plan-${namePrefix}-${resourceToken}'
var appInsightsName = 'appi-${namePrefix}-${resourceToken}'
var logAnalyticsName = 'log-${namePrefix}-${resourceToken}'
var kvReferenceIdentityName = 'id-${namePrefix}-${resourceToken}'

// Two exceptions, both forced by hard name-length caps rather than by choice.
// Storage: 24 chars, lowercase alphanumeric only — no room for any prefix.
var storageAccountName = 'st${take(resourceToken, 22)}'
// Key Vault: 24 chars, so 'withings' does not fit alongside the token.
var keyVaultName = 'kv-ghd-${resourceToken}'

var deploymentContainerName = 'app-package'
var clientSecretName = 'withings-client-secret'
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deploymentContainerName
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// A dedicated user-assigned identity resolves the Key Vault reference below.
// The function app's *system*-assigned identity can't: it doesn't exist until
// the app is created, so it can't be granted vault access beforehand, and the
// app needs to read the secret at creation time. See
// https://learn.microsoft.com/azure/app-service/app-service-key-vault-references#access-vaults-with-a-user-assigned-identity
resource kvReferenceIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: kvReferenceIdentityName
  location: location
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    // RBAC rather than access policies -- one authorization model for the whole
    // deployment, since the storage role assignment below already uses RBAC.
    enableRbacAuthorization: true
    enableSoftDelete: true
    // The floor is 7 days. Kept at the floor so a torn-down environment can be
    // re-provisioned under the same name without `azd down --purge`.
    softDeleteRetentionInDays: 7
  }
}

resource withingsClientSecretValue 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: clientSecretName
  properties: {
    value: withingsClientSecret
  }
}

resource keyVaultSecretsUserRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, kvReferenceIdentity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: kvReferenceIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      keyVaultSecretsUserRoleId // Key Vault Secrets User
    )
  }
}

// Flex Consumption: no capacity to size, scales to zero, billed per execution.
resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  kind: 'functionapp'
  properties: {
    reserved: true // Linux
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  // azd resolves the `broker` service in azure.yaml to this resource by tag --
  // without it, `azd deploy` fails with "unable to find a resource tagged
  // with 'azd-service-name: broker'".
  tags: {
    'azd-service-name': 'broker'
    'azd-env-name': environmentName
  }
  // Both identities are in play: the system-assigned one owns the storage
  // connections below (it is the default when no clientId is given), the
  // user-assigned one exists solely to resolve the Key Vault reference.
  identity: {
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: {
      '${kvReferenceIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    keyVaultReferenceIdentity: kvReferenceIdentity.id
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
    siteConfig: {
      // CORS handled entirely in code (see broker/src/lib/cors.ts) -- leaving
      // the platform's own CORS list empty is deliberate, not an omission.
      // Setting both here and in code would emit two Access-Control-Allow-
      // Origin headers, which browsers reject outright.
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'WITHINGS_CLIENT_ID', value: withingsClientId }
        // Resolved from Key Vault at app start and refreshed periodically, so
        // the secret never lands in site config. `secretUri` is deliberately
        // the unversioned URI -- rotating the secret in the vault then takes
        // effect without redeploying the app.
        {
          name: 'WITHINGS_CLIENT_SECRET'
          value: '@Microsoft.KeyVault(SecretUri=${withingsClientSecretValue.properties.secretUri})'
        }
        { name: 'ALLOWED_ORIGINS', value: allowedOrigins }
        { name: 'ALLOWED_REDIRECT_URIS', value: allowedRedirectUris }
      ]
    }
  }
  // The reference above is resolved during app creation, so the identity must
  // already hold Key Vault Secrets User by then -- ARM won't infer this order.
  dependsOn: [
    keyVaultSecretsUserRoleAssignment
  ]
}

// Grants the function's managed identity permission to read/write its own
// deployment package in blob storage -- required for the SystemAssignedIdentity
// deployment method above.
resource blobDataOwnerRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionApp.id, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  scope: storage
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe' // Storage Blob Data Owner
    )
  }
}

output KEY_VAULT_NAME string = keyVault.name
output FUNCTION_APP_NAME string = functionApp.name
output FUNCTION_APP_HOSTNAME string = functionApp.properties.defaultHostName
output BROKER_URL string = 'https://${functionApp.properties.defaultHostName}/api'
