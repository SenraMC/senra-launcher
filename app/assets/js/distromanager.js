const { DistributionAPI } = require('helios-core/common')

const ConfigManager = require('./configmanager')

// Senra : le distribution.json est publié sur GitHub (dossier distribution/ du dépôt).
// Compte GitHub : SenraMC (réglé par outils/configurer.py --github).
// SENRA_DISTRO_URL permet de tester une autre adresse (ex. http://localhost:8793/distribution_dev.json).
exports.REMOTE_DISTRO_URL = process.env.SENRA_DISTRO_URL || 'https://raw.githubusercontent.com/SenraMC/senra-launcher/main/distribution/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

exports.DistroAPI = api