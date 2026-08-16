// Provisions the Withings token broker: a Flex Consumption Function App
// (Node 22, Linux, scale-to-zero), its storage account, and Application
// Insights. Deploy with `azd up` from the repo root.
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
var functionAppName = 'func-ghd-withings-${resourceToken}'
// Storage account names are capped at 24 chars, lowercase alphanumeric only —
// no room for a descriptive prefix once the uniqueness token is included.
var storageAccountName = 'st${take(resourceToken, 22)}'
var appServicePlanName = 'plan-ghd-withings-${resourceToken}'
var appInsightsName = 'appi-ghd-withings-${resourceToken}'
var logAnalyticsName = 'log-ghd-withings-${resourceToken}'
var deploymentContainerName = 'app-package'

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
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
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
      // CORS handled entirely in code (see api/src/lib/cors.ts) -- leaving
      // the platform's own CORS list empty is deliberate, not an omission.
      // Setting both here and in code would emit two Access-Control-Allow-
      // Origin headers, which browsers reject outright.
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'WITHINGS_CLIENT_ID', value: withingsClientId }
        { name: 'WITHINGS_CLIENT_SECRET', value: withingsClientSecret }
        { name: 'ALLOWED_ORIGINS', value: allowedOrigins }
        { name: 'ALLOWED_REDIRECT_URIS', value: allowedRedirectUris }
      ]
    }
  }
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

output FUNCTION_APP_NAME string = functionApp.name
output FUNCTION_APP_HOSTNAME string = functionApp.properties.defaultHostName
output BROKER_URL string = 'https://${functionApp.properties.defaultHostName}/api'
