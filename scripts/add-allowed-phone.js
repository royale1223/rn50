#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Navigate to parent directory where data folder is
const dataDir = path.join(__dirname, "..", "data");
const allowedPhonesPath = path.join(dataDir, "allowed_phones.json");

function normalizePhone(input) {
    if (!input) return null;

    // Remove all non-digit characters except leading +
    let cleaned = String(input).trim();
    const hasPlus = cleaned.startsWith("+");

    // Strip all formatting: spaces, hyphens, parentheses, dots
    cleaned = cleaned.replace(/[\s\-\(\)\.]/g, "");

    // Remove any remaining non-digits except leading +
    if (hasPlus && cleaned.startsWith("+")) {
        cleaned = "+" + cleaned.substring(1).replace(/\D/g, "");
    } else {
        cleaned = cleaned.replace(/\D/g, "");
    }

    // If it doesn't start with +, try to add country code
    if (!cleaned.startsWith("+")) {
        // 10 digits - likely Indian mobile number
        if (/^\d{10}$/.test(cleaned)) {
            cleaned = "+91" + cleaned;
        }
        // 11-15 digits - add + prefix (likely has country code)
        else if (/^\d{11,15}$/.test(cleaned)) {
            cleaned = "+" + cleaned;
        }
        // Less than 10 or more than 15 digits - invalid
        else {
            return null;
        }
    }

    // Validate E.164 format: + followed by 7-15 digits (minimum 7 for some countries)
    if (!/^\+\d{7,15}$/.test(cleaned)) return null;

    return cleaned;
}

function readAllowedPhones() {
    try {
        if (!fs.existsSync(allowedPhonesPath)) {
            return { phones: [] };
        }
        const content = fs.readFileSync(allowedPhonesPath, "utf-8");
        const data = JSON.parse(content);
        return Array.isArray(data?.phones) ? data : { phones: [] };
    } catch (e) {
        console.error("Error reading allowed_phones.json:", e.message);
        return { phones: [] };
    }
}

function writeAllowedPhones(data) {
    try {
        fs.writeFileSync(allowedPhonesPath, JSON.stringify(data, null, 2), "utf-8");
        return true;
    } catch (e) {
        console.error("Error writing allowed_phones.json:", e.message);
        return false;
    }
}

async function promptPhone() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question("Enter phone number (E.164 format, e.g., +919876543210): ", (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function main() {
    console.log("=== Add Phone to Allowed List ===\n");

    const input = await promptPhone();
    const phone = normalizePhone(input);

    if (!phone) {
        console.error("❌ Invalid phone number format. Must be E.164 format (e.g., +919876543210)");
        process.exit(1);
    }

    console.log(`\n✓ Normalized phone: ${phone}`);

    const data = readAllowedPhones();

    if (data.phones.includes(phone)) {
        console.log(`⚠ Phone number ${phone} is already in the allowed list.`);
        process.exit(0);
    }

    data.phones.push(phone);

    if (writeAllowedPhones(data)) {
        console.log(`✓ Successfully added ${phone} to allowed list`);
        console.log(`✓ File: ${allowedPhonesPath}`);
        console.log(`✓ Total allowed numbers: ${data.phones.length}`);
    } else {
        console.error("❌ Failed to update allowed_phones.json");
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
