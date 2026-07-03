const path = require('path');

/**
 * Returns the directory where output files are stored by default.
 * For this standalone CLI tool, we use the project root's output/ folder.
 */
function getUserDataDir() {
    return path.resolve(__dirname, '..');
}

const USER_DATA_DIR = getUserDataDir();

const ONENOTE_URL = 'https://onenote.cloud.microsoft/notebooks';

module.exports = {
    ONENOTE_URL,
    USER_DATA_DIR,
};
