# Create Static IP for Public LoadBalancer
resource "azurerm_public_ip" "coordinator" {
  name                = "coordinator-service-${var.environment}"
  resource_group_name = data.azurerm_resource_group.existing.name
  location            = data.azurerm_resource_group.existing.location
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = {
    environment = var.environment
  }
}

resource "azurerm_frontdoor" "coordinator" {
  name                                         = "nimiq-setup-${var.environment}"
  # location                                     = "Global"
  resource_group_name                          = data.azurerm_resource_group.existing.name

  routing_rule {
    name               = "RoutingRuleNimiq${var.environment}"
    accepted_protocols = ["Https"]
    patterns_to_match  = ["/*"]
    frontend_endpoints = ["NimiqCeremonyFrontEnd${var.environment}"]
    forwarding_configuration {
      forwarding_protocol = "HttpOnly"
      backend_pool_name   = "CoordinatorLoadBalancer${var.environment}"
    }
  }

  backend_pool_load_balancing {
    name = "LoadBalancingNimiq${var.environment}"
  }

  backend_pool_health_probe {
    name = "HealthProbeNimiq${var.environment}"
  }

  backend_pool_settings {
    enforce_backend_pools_certificate_name_check = false
  }
  
  backend_pool {
    name = "CoordinatorLoadBalancer${var.environment}"
    backend {
      host_header = azurerm_public_ip.coordinator.ip_address
      address     = azurerm_public_ip.coordinator.ip_address
      http_port   = 8080
      https_port  = 8080
    }

    load_balancing_name = "LoadBalancingNimiq${var.environment}"
    health_probe_name   = "HealthProbeNimiq${var.environment}"
  }

  frontend_endpoint {
    name                              = "NimiqCeremonyFrontEnd${var.environment}"
    host_name                         = "nimiq-setup-${var.environment}.azurefd.net"
  }
}

