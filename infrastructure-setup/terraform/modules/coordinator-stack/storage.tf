# Create Storage Bucket and Access Key
resource "azurerm_storage_account" "coordinator_storage" {
  name                     = substr(replace("nimiq-ceremony-${var.environment}", "-", ""), 0, 23)
  resource_group_name      = data.azurerm_resource_group.existing.name
  location                 = data.azurerm_resource_group.existing.location
  account_tier             = "Standard"
  account_replication_type = "GRS"
  allow_nested_items_to_be_public = true
  tags = {
    environment = var.environment
  }
}

output "storage_account_name" {
  value = azurerm_storage_account.coordinator_storage.name
}

output "storage_account_key" {
  value = azurerm_storage_account.coordinator_storage.primary_access_key
}