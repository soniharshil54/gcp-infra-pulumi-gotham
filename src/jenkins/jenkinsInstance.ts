import * as fs from "fs";
import * as gcp from "@pulumi/gcp";
import * as path from "path";
import { gcpProvider } from "../config/provider";
import { GCP_CONFIG, STACK_NAME, CENTRAL_SERVER, VENUE_SERVER, JENKINS_CONFIG } from "../config/constant";
import { escapeXml } from "../utils";

const installDockerScriptPath = path.join(__dirname, "../config/scripts/docker-setup.sh");
const installDockerScript = fs.readFileSync(installDockerScriptPath, "utf-8");

// Read Jenkins job configuration from file
const centralServerJobConfigPath = path.join(__dirname, "../config/jenkins/central-server-job-config.xml");
const venueServerJobConfigPath = path.join(__dirname, "../config/jenkins/venue-server-job-config.xml");

let centralServerJobConfig = fs.readFileSync(centralServerJobConfigPath, "utf-8");
let venueServerJobConfig = fs.readFileSync(venueServerJobConfigPath, "utf-8");

const githubCredentialsConfigPath = path.join(__dirname, "../config/jenkins/github-credentials.xml");
const githubCredentialsConfig = fs.readFileSync(githubCredentialsConfigPath, "utf-8");

const createUserGroovyScriptPath = path.join(__dirname, "../config/jenkins/create-user.groovy");
let createUserGroovyScript = fs.readFileSync(createUserGroovyScriptPath, "utf-8");

const skipWizardGroovyScriptPath = path.join(__dirname, "../config/jenkins/skip-wizard.groovy");
let skipWizardGroovyScript = fs.readFileSync(skipWizardGroovyScriptPath, "utf-8");

const INSTANCE_GROUP_NAME = `${GCP_CONFIG.PROJECT}-${STACK_NAME}-instance-group`
const centralServerJenkinsfilePath = path.join(__dirname, "../config/jenkins/central-server.Jenkinsfile");
let centralServerJenkinsfileContent = escapeXml(fs.readFileSync(centralServerJenkinsfilePath, "utf-8"));
centralServerJenkinsfileContent = centralServerJenkinsfileContent.replace(/__CENTRAL_SERVER_GITHUB_REPO_URL__/g, CENTRAL_SERVER.GITHUB.REPO_URL);
centralServerJenkinsfileContent = centralServerJenkinsfileContent.replace(/__CENTRAL_SERVER_GITHUB_BRANCH__/g, CENTRAL_SERVER.GITHUB.BRANCH);
centralServerJenkinsfileContent = centralServerJenkinsfileContent.replace(/__GCP_PROJECT__/g, GCP_CONFIG.PROJECT);
centralServerJenkinsfileContent = centralServerJenkinsfileContent.replace(/__GCP_REGION__/g, GCP_CONFIG.REGION);
centralServerJenkinsfileContent = centralServerJenkinsfileContent.replace(/__INSTANCE_GROUP_NAME__/g, INSTANCE_GROUP_NAME);
centralServerJenkinsfileContent = centralServerJenkinsfileContent.replace(/__ENVIRONMENT__/g, STACK_NAME);
centralServerJobConfig = centralServerJobConfig.replace(/__CENTRAL_SERVER_JENKINSFILE_CONTENT__/g, centralServerJenkinsfileContent);
centralServerJobConfig = centralServerJobConfig.replace(/__CENTRAL_SERVER_GITHUB_REPO_BRANCH__/g, CENTRAL_SERVER.GITHUB.BRANCH);

const VENUE_ARTIFACT_REPOSITORY_NAME = `${GCP_CONFIG.PROJECT}-${STACK_NAME}-venue-artifact-registry`;
const venueServerJenkinsfilePath = path.join(__dirname, "../config/jenkins/venue-server.Jenkinsfile");
const venueServiceContainerService = `${GCP_CONFIG.PROJECT}-venue-api-service`;
let venueServerJenkinsfileContent = escapeXml(fs.readFileSync(venueServerJenkinsfilePath, "utf-8"));
venueServerJenkinsfileContent = venueServerJenkinsfileContent.replace(/__VENUE_SERVER_GITHUB_REPO_URL__/g, VENUE_SERVER.GITHUB.REPO_URL);
venueServerJenkinsfileContent = venueServerJenkinsfileContent.replace(/__VENUE_SERVER_GITHUB_BRANCH__/g, VENUE_SERVER.GITHUB.BRANCH);
venueServerJenkinsfileContent = venueServerJenkinsfileContent.replace(/__GCP_PROJECT__/g, GCP_CONFIG.PROJECT);
venueServerJenkinsfileContent = venueServerJenkinsfileContent.replace(/__GCP_REGION__/g, GCP_CONFIG.REGION);
venueServerJenkinsfileContent = venueServerJenkinsfileContent.replace(/__VENUE_ARTIFACT_REGISTRY_NAME__/g, VENUE_ARTIFACT_REPOSITORY_NAME);
venueServerJenkinsfileContent = venueServerJenkinsfileContent.replace(/__VENUE_SERVER_SERVICE_NAME__/g, venueServiceContainerService);
venueServerJenkinsfileContent = venueServerJenkinsfileContent.replace(/__VENUE_SERVER_PROD_GITHUB_REPO_URL__/g, VENUE_SERVER.PROD_GITHUB.REPO_URL);
venueServerJenkinsfileContent = venueServerJenkinsfileContent.replace(/__VENUE_SERVER_PROD_GITHUB_BRANCH__/g, VENUE_SERVER.PROD_GITHUB.BRANCH);
venueServerJenkinsfileContent = venueServerJenkinsfileContent.replace(/__ENVIRONMENT__/g, STACK_NAME);
venueServerJobConfig = venueServerJobConfig.replace(/__VENUE_SERVER_JENKINSFILE_CONTENT__/g, venueServerJenkinsfileContent);
venueServerJobConfig = venueServerJobConfig.replace(/__VENUE_SERVER_GITHUB_REPO_BRANCH__/g, VENUE_SERVER.GITHUB.BRANCH);

// Define the new Jenkins username
const newJenkinsUsername = JENKINS_CONFIG.USERNAME;

// Replace placeholders in the Groovy script
createUserGroovyScript = createUserGroovyScript
    .replace(/__NEW_USERNAME__/g, newJenkinsUsername);

const secretId = `${GCP_CONFIG.PROJECT}-${STACK_NAME}-github-token`;
const jenkinsSecretId = `${GCP_CONFIG.PROJECT}-${STACK_NAME}-jenkins-password`;

// Read the setup-github-webhook.sh script
const setupGithubWebhookScriptPath = path.join(__dirname, "../config/scripts/setup-github-webhook.sh");
const setupGithubWebhookScript = fs.readFileSync(setupGithubWebhookScriptPath, "utf-8");
const setupGithubWebhookScriptBase64 = Buffer.from(setupGithubWebhookScript).toString('base64');

export function createJenkinsInstance(name: string, zone: string): gcp.compute.Instance {
    const jenkinsTag = "jenkins";

    const accountId = `${name.slice(0, 24)}-sa`;

    const serviceAccount = new gcp.serviceaccount.Account(`${name}-sa`, {
        accountId: accountId,
        displayName: "Jenkins Service Account",
    }, { provider: gcpProvider });

    const roles = [
        "roles/compute.admin",
        "roles/storage.admin",
        "roles/iam.serviceAccountUser",
        "roles/secretmanager.secretAccessor",
        "roles/artifactregistry.writer",
    ];

    roles.forEach(role => {
        new gcp.projects.IAMMember(`${name}-sa-${role}`, {
            member: serviceAccount.email.apply(email => `serviceAccount:${email}`),
            role: role,
            project: gcp.config.project!,
        }, { provider: gcpProvider });
    });

    const network = new gcp.compute.Network(`${name}-network`, {
        autoCreateSubnetworks: true,
    }, { provider: gcpProvider });

    const firewall = new gcp.compute.Firewall(`${name}-firewall`, {
        network: network.selfLink,
        allows: [
            {
                protocol: "tcp",
                ports: ["22", "8080"],
            },
        ],
        direction: "INGRESS",
        sourceRanges: ["0.0.0.0/0"],
        targetTags: [jenkinsTag],
    }, { provider: gcpProvider });

    const instance = new gcp.compute.Instance(name, {
        machineType: "n1-standard-1",
        zone: zone,
        bootDisk: {
            initializeParams: {
                image: "ubuntu-os-cloud/ubuntu-2004-lts",
            },
        },
        networkInterfaces: [{
            network: network.selfLink,
            accessConfigs: [{}],
        }],
        serviceAccount: {
            email: serviceAccount.email,
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        },
        metadataStartupScript: `#!/bin/bash
        {
            echo "Starting Jenkins installation"

            # Add Jenkins GPG key and repository
            echo "Adding Jenkins GPG key and repository..."
            curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key | sudo tee /usr/share/keyrings/jenkins-keyring.asc > /dev/null
            echo "Jenkins GPG key and repository added."

            # Add Jenkins source to apt sources list
            echo "Adding Jenkins source to apt sources list..."
            echo deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/ | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null
            echo "Jenkins source added."

            # Update and install necessary packages
            echo "Updating apt-get and installing necessary packages..."
            sudo apt-get update

            # Docker and Docker Compose installation
            echo "Installing Docker and Docker Compose..."
            echo '${installDockerScript}' > /tmp/install-docker.sh
            chmod +x /tmp/install-docker.sh
            /tmp/install-docker.sh

            # Install OpenJDK 17 instead of OpenJDK 11
            sudo apt-get install -y openjdk-17-jdk jq jenkins
            echo "Packages installed."

            # Ensure Jenkins home directory exists and is owned by Jenkins
            sudo mkdir -p /var/lib/jenkins
            sudo chown -R jenkins:jenkins /var/lib/jenkins

            # Create Groovy script to disable the setup wizard
            echo "Creating Groovy script to disable the setup wizard..."
            echo '${skipWizardGroovyScript}' > /tmp/skip-wizard.groovy
            sudo mkdir -p /var/lib/jenkins/init.groovy.d
            sudo cp /tmp/skip-wizard.groovy /var/lib/jenkins/init.groovy.d/skip-wizard.groovy
            sudo chown -R jenkins:jenkins /var/lib/jenkins/init.groovy.d

            # Prepare the user creation Groovy script
            echo '${createUserGroovyScript}' > /tmp/create-user.groovy
            echo "Fetching Jenkins password from Secret Manager: ${jenkinsSecretId}"
            JENKINS_PASSWORD=$(gcloud secrets versions access latest --secret="${jenkinsSecretId}")
            sed -i 's|__NEW_PASSWORD__|'"$JENKINS_PASSWORD"'|g' /tmp/create-user.groovy

            # Replace __NEW_USERNAME__ placeholder
            NEW_JENKINS_USERNAME="${newJenkinsUsername}"
            sed -i 's|__NEW_USERNAME__|'"$NEW_JENKINS_USERNAME"'|g' /tmp/create-user.groovy

            # Move the script to init.groovy.d
            sudo cp /tmp/create-user.groovy /var/lib/jenkins/init.groovy.d/create-user.groovy
            sudo chown jenkins:jenkins /var/lib/jenkins/init.groovy.d/create-user.groovy

            # Start Jenkins service
            echo "Starting Jenkins service..."
            sudo systemctl start jenkins
            sudo systemctl enable jenkins
            echo "Jenkins service started and enabled."

            sleep 60

            # Wait for Jenkins to fully start
            echo "Waiting for Jenkins to fully start..."
            while ! curl -s http://localhost:8080 >/dev/null; do
                echo "Jenkins is not ready yet, waiting..."
                sleep 60
            done
            echo "Jenkins is up and running."

            # Fetch the initial admin password
            echo "Fetching the initial admin password..."
            ADMIN_PASSWORD=$(sudo cat /var/lib/jenkins/secrets/initialAdminPassword)
            echo "Admin password fetched."

            # Install Jenkins CLI
            echo "Installing Jenkins CLI..."
            JENKINS_CLI="/tmp/jenkins-cli.jar"
            curl -L -o $JENKINS_CLI http://localhost:8080/jnlpJars/jenkins-cli.jar
            echo "Jenkins CLI installed."

            # Ensure the Jenkins CLI is downloaded correctly
            if [ ! -f "$JENKINS_CLI" ]; then
                echo "Jenkins CLI not found!"
                exit 1
            fi

            echo "Seems like Jenkins is up and running. Let's wait for a minute to make sure everything is settled."

            sleep 60

            plugins_to_install="cloudbees-folder antisamy-markup-formatter build-timeout credentials credentials-binding timestamper ws-cleanup ant gradle workflow-aggregator github-branch-source pipeline-github-lib pipeline-graph-view git github ssh-slaves matrix-auth pam-auth ldap email-ext mailer dark-theme workflow-job"
            echo "Installing suggested plugins: $plugins_to_install"
            retries=5
            while [ $retries -gt 0 ]; do
                echo "Installing suggested plugins..."
                java -jar $JENKINS_CLI -s http://localhost:8080/ -auth admin:$ADMIN_PASSWORD install-plugin $plugins_to_install && break
                retries=$((retries - 1))
                echo "Retrying plugin installation..."
                sleep 10
            done

            if [ $retries -eq 0 ]; then
                echo "Failed to install plugins after multiple attempts."
                exit 1
            fi

            sleep 60

            # Restart Jenkins to apply plugin installations
            echo "Restarting Jenkins to apply plugin installations..."
            sudo systemctl restart jenkins
            echo "Jenkins restarted."

            # Wait for Jenkins to be ready again
            echo "Waiting for Jenkins to be ready after restart..."
            while ! curl -sSf http://localhost:8080/login > /dev/null; do
                sleep 10
            done
            echo "Jenkins is ready after restart."

            # Verify that Jenkins is back up
            while ! curl -s http://localhost:8080 >/dev/null; do
                echo "Waiting for Jenkins to restart after plugin installation..."
                sleep 60
            done
            echo "Jenkins is up after plugin installation."
            sleep 30

            # Define the GitHub credentials ID
            GITHUB_CREDENTIALS_ID="github-token-v1"

            # Define github repo urls
            CENTRAL_SERVER_GITHUB_REPO_URL="${CENTRAL_SERVER.GITHUB.REPO_URL}"
            VENUE_SERVER_GITHUB_REPO_URL="${VENUE_SERVER.GITHUB.REPO_URL}"

            # Fetch GitHub token from Google Secret Manager
            echo "Fetching GitHub token from Secret Manager: ${secretId}"
            GITHUB_TOKEN=$(gcloud secrets versions access latest --secret="${secretId}")
            echo "GitHub token: $GITHUB_TOKEN"
            echo '${githubCredentialsConfig}' > /tmp/github-credentials.xml
            sed -i 's|__GITHUB_TOKEN__|'"$GITHUB_TOKEN"'|g' /tmp/github-credentials.xml

            # Create credentials using the external XML file
            echo "Creating GitHub credentials using external XML file..."
            java -jar $JENKINS_CLI -s http://localhost:8080/ -auth admin:$ADMIN_PASSWORD create-credentials-by-xml system::system::jenkins _ < /tmp/github-credentials.xml
            echo "GitHub credentials created successfully."

            # Create Jenkins central server job using the Jenkins CLI with default admin credentials
            echo "Creating central server Jenkins job..."
            echo '${centralServerJobConfig}' > /tmp/central-server-job-config.xml
            sed -i 's|__GITHUB_CREDENTIALS_ID__|'"$GITHUB_CREDENTIALS_ID"'|g' /tmp/central-server-job-config.xml
            sed -i 's|__CENTRAL_SERVER_GITHUB_REPO_URL__|'"$CENTRAL_SERVER_GITHUB_REPO_URL"'|g' /tmp/central-server-job-config.xml
            java -jar $JENKINS_CLI -s http://localhost:8080 -auth admin:$ADMIN_PASSWORD create-job nodejs-central-server-deployment-job < /tmp/central-server-job-config.xml || { echo "Failed to create Jenkins central server job"; exit 1; }
            echo "Jenkins central server job created successfully."

            # Create Jenkins venue server job using the Jenkins CLI with default admin credentials
            echo "Creating venue server Jenkins job..."
            echo '${venueServerJobConfig}' > /tmp/venue-server-job-config.xml
            sed -i 's|__GITHUB_CREDENTIALS_ID__|'"$GITHUB_CREDENTIALS_ID"'|g' /tmp/venue-server-job-config.xml
            sed -i 's|__VENUE_SERVER_GITHUB_REPO_URL__|'"$VENUE_SERVER_GITHUB_REPO_URL"'|g' /tmp/venue-server-job-config.xml
            java -jar $JENKINS_CLI -s http://localhost:8080 -auth admin:$ADMIN_PASSWORD create-job nodejs-venue-server-deployment-job < /tmp/venue-server-job-config.xml || { echo "Failed to create Jenkins venue server job"; exit 1; }
            echo "Jenkins venue server job created successfully."

            # Write the base64-encoded Groovy script to a file
            echo '${createUserGroovyScript}' > /tmp/create-user.groovy
            echo "Fetching Jenkins password from Secret Manager: ${jenkinsSecretId}"
            JENKINS_PASSWORD=$(gcloud secrets versions access latest --secret="${jenkinsSecretId}")
            sed -i 's|__NEW_PASSWORD__|'"$JENKINS_PASSWORD"'|g' /tmp/create-user.groovy
            
            # Execute the Groovy script via Jenkins CLI
            echo "Creating new admin user..."
            java -jar $JENKINS_CLI -s http://localhost:8080/ -auth admin:$ADMIN_PASSWORD groovy = < /tmp/create-user.groovy
            echo "New admin user created successfully."

            # Save the password to a file for later retrieval
            echo $ADMIN_PASSWORD > /var/lib/jenkins/admin-password.txt
            sudo chmod 600 /var/lib/jenkins/admin-password.txt
            echo "Admin password saved to /var/lib/jenkins/admin-password.txt"

            # Write setup-github-webhook.sh to /tmp using base64 decoding
            echo '${setupGithubWebhookScriptBase64}' | base64 -d > /tmp/setup-github-webhook.sh
            chmod +x /tmp/setup-github-webhook.sh


            # Fetch GitHub token and repository details
            CENTRAL_SERVER_REPO="${CENTRAL_SERVER.GITHUB.REPO_OWNER}/${CENTRAL_SERVER.GITHUB.REPO_NAME}"
            VENUE_SERVER_REPO="${VENUE_SERVER.GITHUB.REPO_OWNER}/${VENUE_SERVER.GITHUB.REPO_NAME}"
            WEBHOOK_URL="http://$(curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H 'Metadata-Flavor: Google'):8080/github-webhook/"
            echo "Webhook URL: $WEBHOOK_URL"

            # Execute the webhook setup script for each repository
            /tmp/setup-github-webhook.sh "$CENTRAL_SERVER_REPO" "$GITHUB_TOKEN" "$WEBHOOK_URL"
            /tmp/setup-github-webhook.sh "$VENUE_SERVER_REPO" "$GITHUB_TOKEN" "$WEBHOOK_URL"

            # Add the jenkins user to the docker group
            sudo usermod -aG docker jenkins
            sudo usermod -aG docker $(whoami)
            newgrp docker

            # Restart Jenkins to apply configuration changes
            sleep 60
            sudo systemctl restart jenkins

            echo "Jenkins setup complete"
        } &>> /var/log/jenkins-install.log
        `,
        tags: [jenkinsTag],
        allowStoppingForUpdate: true,
    }, { provider: gcpProvider });

    return instance;
}
