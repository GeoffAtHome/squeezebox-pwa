import axios from 'axios';
// Import dotenv and use it to load environment variables from .env.local
import { config } from 'dotenv';
config({ path: '.env.local' });

/**
 * @typedef {"Artists" | "Albums" | "Tracks" | "Genres" | "Years" | "Folders" | "Playlists"} CategoryType
 */

// Retrieve the LMS URL from environment variables, using a fallback default.
const DEFAULT_LMS_URL = process.env.VITE_LMS_SERVER_URL || 'http://localhost:8080';

/**
 * Fetches and logs raw JSON data for a specific category (e.g., "Artists", "Tracks").
 * NOTE: This feature relies on an assumed API endpoint structure and may fail if the LMS server does not implement it.
 * @param {string} category - The resource type to fetch.
 */
async function dumpCategoryData(category: string) {
    console.log(`\n===================================================`);
    console.log(`🌐 Attempting raw data dump for Category: ${category}`);
    console.log(`===================================================`);

    // Assuming a generic endpoint structure based on common API patterns.
    const url = `${DEFAULT_LMS_URL}/api/${category.toLowerCase()}`;

    try {
        console.log(`Fetching data from: ${url}`);

        const headers = {
            'X-API-Key': process.env.LMS_API_KEY || '',
            'Authorization': `Basic ${Buffer.from(`${process.env.LMS_USERNAME}:${process.env.LMS_PASSWORD}`).toString('base64')}`
        };

        const response = await axios.get(url, { headers });

        console.log("---------------------------------------------------");
        if (response.status >= 200 && response.status < 300) {
            console.log(`✅ Successfully retrieved ${category}. Status Code: ${response.status}`);
            // Dump the raw JSON data to standard output for review
            console.log(JSON.stringify(response.data, null, 2));
        } else {
            console.error(`❌ Failed to retrieve ${category}. Received status code: ${response.status}`);
        }

    } catch (error) {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            if (!status && ['ECONNREFUSED', 'ETIMEDOUT'].includes(error.code || '') ) {
                console.error("\n❌ Error: Connection refused.");
                console.error("Message: Ensure the LMS server is running and accessible at the specified URL.");
            } else if (status === 401 || status === 403) {
                 console.error(`\n❌ Authentication Failed.`);
                 console.error(`Status: ${status}`);
                 console.error("Message: Unauthorized access. Please ensure LMS credentials are correctly set in your environment variables.");
            } else if (status === 404) {
                 console.error(`\n❌ Endpoint Not Found.`);
                 console.error(`Status: ${status}`);
                // Added context about the API scope limitation here.
                console.error("Message: The resource '${category}' endpoint was not found at this URL. This indicates that comprehensive metadata browsing is likely handled by a dedicated service like SlimBrowse (Phase 2).");
            } else {
                // Handle all other failures (e.g., 500 server error)
                console.error(`\n❌ Failed to dump ${category}.`);
                console.error(`Status: ${status || 'Unknown'}`);
                console.error(`Details: ${axios.isAxiosError(error) ? error.message : 'Check network connectivity.'}`);
            }
        } else {
            console.error("\n❌ An unknown critical error occurred:", error);
        }
    }
}

/**
 * Main CLI entry point function. Reads categories from command line arguments and dumps raw data.
 */
async function runCli() {
    // Arguments passed: npx ts-node src/cli/index.ts <Category1> <Category2> ...
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log("Usage: npx ts-node src/cli/index.ts <Artists | Albums | Tracks | Genres | Years | Folders | Playlists>");
        console.log("\nArguments must be valid Category Types (e.g., Artists). Each argument will trigger a raw data dump.");
    } else {
         for (const category of args) {
             await dumpCategoryData(category);
    }
}
}

runCli();