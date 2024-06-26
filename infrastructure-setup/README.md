# Infrastructure Setup 

## Pre-Requisites 

The infrastructure for the SNARK Ceremony is designed to be deployed with Terraform and Helm 3, you will need the binaries for both of these installed before proceeding with a Deployment. 

- Terraform: https://learn.hashicorp.com/tutorials/terraform/install-cli
- Helm 3: https://helm.sh/docs/intro/install/

This deployment also relies exclusively on Azure resources, and will require the machine you are deploying from to be properly authenticated via the Azure CLI. 

`az login`

For more details see: https://docs.microsoft.com/en-us/cli/azure/authenticate-azure-cli

{{ Insert permissions that are required here. }}

You will also need to do the following: 
- Generate Verifier Key(s) (in [operator repo](https://github.com/nimiq/snark-setup-operator)): 
```
cargo run --release --bin generate -- -f nimiq-verifier.keys
```

Make note of the generated account public key and the path of the key, you will need these later.

## Build your Docker Images 

The example deployment uses `test` images, to build your own from source, run the `release-docker.py` script in the coordinator and operator repositories. 

`python3 scripts/release-docker.py release-docker --tag $YOUR_TAG_HERE`

You may optionally specify a different repository (like dockerhub) with the `--repository` flag: 

`--repository registry.hub.docker.com/username --tag $YOUR_TAG`

## Create Your Environment

An example deployment is available in `/terraform/example`. Depending on the available infrastructure, you may want to deploy the Ceremony to an existing Kubernetes cluster, however an Azure Kuberentes module has been provided that creates the required resources. 

You may use the example deployment for testing purposes, but it is recommended that you modify the variables to suit your setup. At minimum, change the variable `local.environment` to ensure nothing overlaps with previous deployments. 

Additional Settings to Change: 
```
locals {
  environment                   = "example"
  cluster_prefix                = "nimiq-${local.environment}"
  resource_group_name           = "nimiq-${local.environment}"
  // update the coordinator image here
  coordinator_service_image_tag = "test"
  coordinator_service_image     = "coordinator-service"
  // update the operator image(s) here
  verifier_image                = "snark-ceremony-operator"
  verifier_image_tag            = "test"
  monitor_image                 = "snark-ceremony-operator"
  monitor_image_tag             = "test"
  monitor_polling_interval      = 1
  // Add your verifier public keys here 
  initial_verifier_public_keys  = "ba154fac00e55e69ea72bb4966e8f19baf5ad8565e1b67018800b6570828618c e885ad0da659616319ca91d02659c01e8bcbe13ea2fff003bf6258bcc226a1e9 92b09c7071ee39be8f20efbaf5db90d6b5c367516ff11bd73c8212f8e382a7c9"
  // specify your verifier key files here
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
}
```


Note: All of the following `terraform` commands must be run from within your environment folder (`/infrastructure-setup/terraform/example` if you are using the example)

## Seeing What Will Be Deployed 

Running `terraform plan` will have Terraform resolve the dependency graph of what will be deployed, but stop short of deploying it. 

## Creating the Infrastructure

Running `terraform apply` in the example directory will get you the following: 

- An Azure Resource Group
- An Azure Kubernetes Cluster
- Helm releases consisting of: 
  - Ceremony Coordinator Service API 
  - Ceremony Verifiers (ToDo)
  - Prometheus (ToDo)
- An Azure Front Door pointed at the Coordinator Service API
- An Azure Storage Account for the Coordinator Service API 

Note: The deploy from scratch will take between 4-8 minutes, primarily due to deploying the cluster. To speed up deployments, specify an existing K8s cluster in your environment.

Once deployed, the example terraform environment will output helpful information: 
```
Apply complete! Resources: 20 added, 0 changed, 0 destroyed.

Outputs:

cluster_name = nimiq-example-aks
front_door_hostname = nimiq-setup-example.azurefd.net
kube_ctl_command = az aks get-credentials --resource-group nimiq-example --name nimiq-example-aks
storage_account_key = <azure-key>
storage_account_name = nimiqceremonyexample
```

The `kube_ctl_command` can be used to configure your local kubectl environment to access the cluster. 

You may verify that the deployment is functioning normally by doing the following: 
- Visit the front-door in a browser: `https://nimiq-setup-example.azurefd.net/ceremony`
- Check the pod logs via `kubectl`: 
Note: the namespace will be the name of the environment you specified.

```
$ kubectl get pods --namespace example

NAME                                        READY   STATUS    RESTARTS   AGE
nimiq-coordinator-example-0                 1/1     Running   1          18h
nimiq-monitor-example-78b6c6fcf5-qb8bz      1/1     Running   0          19h
nimiq-verifier-example-0-844849696f-qz7gx   1/1     Running   0          19h
nimiq-verifier-example-1-5dcf4784d9-rr5gw   1/1     Running   0          19h
nimiq-verifier-example-2-57cb67cd4f-k6zgx   1/1     Running   0          19h
```

```
$ kubectl logs nimiq-verifier-example-0-844849696f-qz7gx

Enter your Nimiq setup passphrase:
{"timestamp":"Nov 09 23:58:23.881","level":"INFO","fields":{"message":"Successfully contributed, thank you for participation! Waiting to see if you're still needed... Don't turn this off! "},"target":"contribute"}
{"timestamp":"Nov 09 23:58:23.912","level":"INFO","fields":{"message":"Successfully contributed, thank you for participation! Waiting to see if you're still needed... Don't turn this off! "},"target":"contribute"}
```

## Initialize the Ceremony

Next, we must initialize the ceremony using the `new_ceremony` binary from the [operator repo](https://github.com/nimiq/snark-setup-operator). 

```
RUST_LOG=info  cargo run  --release --bin new_ceremony -- --upload-mode azure --storage-account nimiqceremonyexample --container chunks --access-key <Azure-Key-From-Output> --chunk-size 8 --powers 12 --verifier <Your-Verifier-PublicKey> --participant <Participant-PublicKey> --server-url '<Nimiq-Coordinator-Uri>' --keys-file /path/to/nimiq.keys 
```

This will then generate and upload all the Chunks and challenges to Azure Block Storage, and configure the Coordinator's local JSON DB. You can verify it is set up by visiting 

## Contributing

Once the ceremony is initialized, the deployment is ready for participants to begin contributing. 

```
RUST_LOG=info cargo run --release --bin contribute -- --coordinator-url http://$COORDINATOR_URI --keys-file /path/to/nimiq.keys --participation-mode contribute
```

## Resetting the Ceremony

Sometimes, we want to be able to reset the ceremony without going through a whole redeployment process. This is very simple with the following kubectl commands: 

```
kubectl exec nimiq-coordinator-example-0 -- rm -rf /db/db.json && \
k delete pod nimiq-coordinator-example-0
```

This deletes the on-disk JSON Database, and restarts the coordinator pod. You can verify that the ceremony has reset by visiting the front-door address `/ceremony`. 

## Updating Coordinator Runtime Parameters

Currently, the Coordinator deployment does not respond to ConfigMap updates, so updating the values passed to the Helm release will have no effect beyond applying the new ConfigMap(s). Once the ConfigMap is updated (after running `terraform apply`), you have to delete the JSON database and restart the coordinator pod. 

Note: This process also applies to the other actor roles (monitor, verifier, etc.)

```
kubectl exec nimiq-coordinator-example-0 -- rm -rf /db/db.json && \
k delete pod nimiq-coordinator-example-0
```

## Cleaning Up 

Running `terraform destroy` will clean up your environment and any resources that were created.


NOTE: There is currently a bug in the Azure LoadBalancer Service Finalizer, which will (occasionally) prevent the deployed namespace from being deleted. This, (annoyingly), can be fixed by manually removing the load-balancer finalizer like so: 

`KUBE_EDITOR="vim" k edit svc nimiq-coordinator-$ENVIRONMENT_NAME`

and replacing the `finalizers` block with an empty array `[]` like so: 

`finalizers: []`

Saving the file will result in the namespace being updated and likely immediately deleted. From there you may proceed with another `terraform destroy`.