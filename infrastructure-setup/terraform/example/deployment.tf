provider "azurerm" {
  version = "=3.72.0"
  features {}
}

# Configure the Microsoft Azure Active Directory Provider
provider "azuread" {
  version = "~> 2.41.0"
}

# Local variables that define the deployment, make changes here as-needed
locals {
  environment                   = "example"
  cluster_prefix                = "nimiq-${local.environment}"
  resource_group_name           = "nimiq-${local.environment}"
  coordinator_service_image_tag = "test"
  coordinator_service_image     = "coordinator-service"
  verifier_image                = "snark-ceremony-operator"
  verifier_image_tag            = "test"
  monitor_image                 = "snark-ceremony-operator"
  monitor_image_tag             = "test"
  monitor_polling_interval      = 1
  initial_verifier_public_keys  = "ba154fac00e55e69ea72bb4966e8f19baf5ad8565e1b67018800b6570828618c e885ad0da659616319ca91d02659c01e8bcbe13ea2fff003bf6258bcc226a1e9 92b09c7071ee39be8f20efbaf5db90d6b5c367516ff11bd73c8212f8e382a7c9"
  verifier_credentials = [
    {
      path     = "./nimiq-verifier-1.keys"
      password = "1"
    },
    {
      path     = "./nimiq-verifier-2.keys"
      password = "1"
    },
    {
      path     = "./nimiq-verifier-3.keys"
      password = "1"
    }
  ]
  alerts_email_address = "<email>@<address>.com"
}

resource "azurerm_resource_group" "coordinator_group" {
  name     = local.resource_group_name
  location = "West US"
}



# The Helm 3 Provider, you can simply configure this if you need to deploy to an existing cluster.
# Ex. Azure Cluster Data Source: https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/data-sources/kubernetes_cluster
provider helm {
  version = "~> 2.11.0"
  debug   = true
  kubernetes {
    host                   = module.aks.admin_host
    client_certificate     = base64decode(module.aks.admin_client_certificate)
    client_key             = base64decode(module.aks.admin_client_key)
    cluster_ca_certificate = base64decode(module.aks.admin_cluster_ca_certificate)
    username               = module.aks.admin_username
    password               = module.aks.admin_password
  }
}

# Kubernetes Provider (used for creating namespaces)
provider "kubernetes" {
  version                = "~> 2.23.0"
  host                   = module.aks.admin_host
  client_certificate     = base64decode(module.aks.admin_client_certificate)
  client_key             = base64decode(module.aks.admin_client_key)
  cluster_ca_certificate = base64decode(module.aks.admin_cluster_ca_certificate)
  username               = module.aks.admin_username
  password               = module.aks.admin_password
}

# The coordinator stack and any other kubernetes resources that are needed
module "deployment" {
  source                        = "../modules/coordinator-stack"
  environment                   = local.environment
  coordinator_service_image_tag = local.coordinator_service_image_tag
  coordinator_service_image     = local.coordinator_service_image
  verifier_image                = local.verifier_image
  verifier_image_tag            = local.verifier_image_tag
  monitor_image                 = local.monitor_image
  monitor_image_tag             = local.monitor_image_tag
  monitor_polling_interval      = local.monitor_polling_interval
  initial_verifier_public_keys  = local.initial_verifier_public_keys
  verifier_credentials          = local.verifier_credentials
  verifier_count                = length(local.verifier_credentials)
  resource_group_name           = local.resource_group_name
  log_analytics_workspace_name  = "${local.cluster_prefix}-workspace"
  azure_monitor_alerts_email_address = local.alerts_email_address
  depends_on                    = [azurerm_resource_group.coordinator_group]
}

output "front_door_hostname" {
  value = module.deployment.front_door_hostname
}
output "cluster_name" {
  value = "${local.cluster_prefix}-aks"
}

output "storage_account_name" {
  value = module.deployment.storage_account_name
}

output "storage_account_key" {
  value = nonsensitive(module.deployment.storage_account_key)
}

output "kube_ctl_command" {
  value = "az aks get-credentials --resource-group ${local.resource_group_name} --name ${local.cluster_prefix}-aks"
}