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

@description('Google OAuth client ID. Public by design -- same posture as VITE_GOOGLE_CLIENT_ID and withingsClientId. Used server-side only as the expected "aud" when the bloodwork function verifies the Google access token presented by the caller.')
param googleClientId string

@description('Comma-separated browser origins allowed to call the bloodwork function.')
param bloodworkAllowedOrigins string = 'https://mikokono.de,http://localhost:5173,http://127.0.0.1:5173'

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

// Bloodwork tracking function (bloodwork/, .NET 10 isolated worker) -- a
// third, independent Function App sharing only the passive/observability
// resources above (Log Analytics, App Insights) with the broker. Its own
// storage account, plan, and Document Intelligence resource, following the
// same naming convention as the broker's resources.
var bwNamePrefix = 'ghd-bloodwork'
var bwFunctionAppName = 'func-${bwNamePrefix}-${resourceToken}'
var bwAppServicePlanName = 'plan-${bwNamePrefix}-${resourceToken}'
var bwDocumentIntelligenceName = 'di-${bwNamePrefix}-${resourceToken}'
// 'stbw' discriminates this account from the broker's own 'st<token>' name,
// which reuses the same resourceToken and would otherwise collide.
var bwStorageAccountName = 'stbw${take(resourceToken, 20)}'
var bwDeploymentContainerName = 'app-package'
var bwDocumentsContainerName = 'bloodwork-documents'
var bwJobsTableName = 'bloodworkJobs'
var bwResultsTableName = 'bloodworkResults'
var bwQueueName = 'bloodwork-processing'

// Confirmed against Microsoft's current built-in-role list -- note this is
// NOT the same GUID the storage.blobDataOwnerRoleAssignment below uses
// (despite that resource's own comment calling it "Storage Blob Data
// Owner"): b7e6dc6d-f1e8-4753-8033-0f276bb0955b is Owner, ba92f5b4-... below
// is actually Contributor. Left as-is above since it still grants the
// broker's deployment identity what it needs; named correctly here so the
// mislabel isn't repeated.
var bwStorageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var bwStorageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var bwStorageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
// The exact role Microsoft's own SDK quickstarts (C#/Python/JS alike)
// specify for DefaultAzureCredential access to Document Intelligence.
var bwCognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'

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

// ---------------------------------------------------------------------------
// Bloodwork tracking function (bloodwork/)
// ---------------------------------------------------------------------------

resource bwStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: bwStorageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource bwBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: bwStorage
  name: 'default'
}

resource bwDeploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: bwBlobService
  name: bwDeploymentContainerName
}

resource bwDocumentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: bwBlobService
  name: bwDocumentsContainerName
}

resource bwTableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: bwStorage
  name: 'default'
}

resource bwJobsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: bwTableService
  name: bwJobsTableName
}

resource bwResultsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: bwTableService
  name: bwResultsTableName
}

resource bwQueueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: bwStorage
  name: 'default'
}

resource bwProcessingQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: bwQueueService
  name: bwQueueName
}

// Document Intelligence (Cognitive Services). 'FormRecognizer' is still the
// correct ARM `kind` even though the product itself was renamed.
// customSubDomainName is REQUIRED for Entra ID (managed identity) auth --
// regional endpoints without one don't support it.
resource documentIntelligence 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: bwDocumentIntelligenceName
  location: location
  kind: 'FormRecognizer'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: bwDocumentIntelligenceName
    publicNetworkAccess: 'Enabled'
  }
}

// Flex Consumption, same posture as the broker's plan: no capacity to size,
// scales to zero, billed per execution.
resource bwAppServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: bwAppServicePlanName
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

resource bloodworkFunctionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: bwFunctionAppName
  location: location
  kind: 'functionapp,linux'
  // azd resolves the `bloodwork` service in azure.yaml to this resource by
  // tag -- without it, `azd deploy` fails the same way the broker's own
  // comment above describes.
  tags: {
    'azd-service-name': 'bloodwork'
    'azd-env-name': environmentName
  }
  // System-assigned only: unlike the broker, there is no Key Vault
  // reference to resolve here (Document Intelligence auth uses this same
  // identity directly, granted Cognitive Services User below), so no
  // user-assigned identity is needed.
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: bwAppServicePlan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${bwStorage.properties.primaryEndpoints.blob}${bwDeploymentContainerName}'
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
        name: 'dotnet-isolated'
        // Verify against `az functionapp list-flexconsumption-runtimes
        // --location <region> --runtime dotnet-isolated` before the first
        // real deploy -- Flex Consumption's supported-version strings for
        // .NET aren't guaranteed to match the NuGet/TFM version format.
        version: '10.0'
      }
    }
    siteConfig: {
      // CORS handled entirely in code (see bloodwork/Services/CorsService.cs
      // and Middleware/GoogleAuthMiddleware.cs) -- same reasoning as the
      // broker's own siteConfig comment: leaving the platform's CORS list
      // empty is deliberate, not an omission.
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: bwStorage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'GOOGLE_CLIENT_ID', value: googleClientId }
        { name: 'ALLOWED_ORIGINS', value: bloodworkAllowedOrigins }
        { name: 'STORAGE_ACCOUNT_NAME', value: bwStorage.name }
        { name: 'DOCUMENT_INTELLIGENCE_ENDPOINT', value: documentIntelligence.properties.endpoint }
        // No DOCUMENT_INTELLIGENCE_KEY here on purpose -- prod calls
        // Document Intelligence with this Function's own managed identity
        // (see bwDocIntelRoleAssignment below), not a key.
      ]
    }
  }
}

resource bwBlobRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(bwStorage.id, bloodworkFunctionApp.id, bwStorageBlobDataContributorRoleId)
  scope: bwStorage
  properties: {
    principalId: bloodworkFunctionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      bwStorageBlobDataContributorRoleId // Storage Blob Data Contributor
    )
  }
}

resource bwTableRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(bwStorage.id, bloodworkFunctionApp.id, bwStorageTableDataContributorRoleId)
  scope: bwStorage
  properties: {
    principalId: bloodworkFunctionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      bwStorageTableDataContributorRoleId // Storage Table Data Contributor
    )
  }
}

resource bwQueueRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(bwStorage.id, bloodworkFunctionApp.id, bwStorageQueueDataContributorRoleId)
  scope: bwStorage
  properties: {
    principalId: bloodworkFunctionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      bwStorageQueueDataContributorRoleId // Storage Queue Data Contributor
    )
  }
}

resource bwDocIntelRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(documentIntelligence.id, bloodworkFunctionApp.id, bwCognitiveServicesUserRoleId)
  scope: documentIntelligence
  properties: {
    principalId: bloodworkFunctionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      bwCognitiveServicesUserRoleId // Cognitive Services User
    )
  }
}

output BLOODWORK_FUNCTION_APP_NAME string = bloodworkFunctionApp.name
output BLOODWORK_URL string = 'https://${bloodworkFunctionApp.properties.defaultHostName}/api'
output DOCUMENT_INTELLIGENCE_ENDPOINT string = documentIntelligence.properties.endpoint
