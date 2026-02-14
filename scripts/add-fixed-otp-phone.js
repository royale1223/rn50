#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env to show the current OTP code
dotenv.config({ path: "/var/www/fleetapt/.env" });

// Navigate to parent directory where data folder is
const dataDir = path.join(__dirname, "..", "data");
const fixedOtpPhonesPath = path.join(dataDir, "fixed_otp_phones.txt");

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

function readFixedOtpPhones() {
    try {
        if (!fs.existsSync(fixedOtpPhonesPath)) {
            return [];
        }
        const content = fs.readFileSync(fixedOtpPhonesPath, "utf-8");
        return content
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("+"));
    } catch (e) {
        console.error("Error reading fixed_otp_phones.txt:", e.message);
        return [];
    }
}

function writeFixedOtpPhones(phones) {
    try {
        fs.writeFileSync(fixedOtpPhonesPath, phones.join("\n") + "\n", "utf-8");
        return true;
    } catch (e) {
        console.error("Error writing fixed_otp_phones.txt:", e.message);
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
    console.log("=== Add Phone to Fixed OTP List ===\n");

    const FIXED_OTP_CODE = process.env.REUNION50_FIXED_OTP_CODE || "654321";
    console.log(`📱 Current Fixed OTP Code: ${FIXED_OTP_CODE}\n`);

    const input = await promptPhone();
    const phone = normalizePhone(input);

    if (!phone) {
        console.error("❌ Invalid phone number format. Must be E.164 format (e.g., +919876543210)");
        process.exit(1);
    }

    console.log(`\n✓ Normalized phone: ${phone}`);

    const phones = readFixedOtpPhones();

    if (phones.includes(phone)) {
        console.log(`⚠ Phone number ${phone} is already in the fixed OTP list.`);
        console.log(`📱 This number can use OTP code: ${FIXED_OTP_CODE}`);
        process.exit(0);
    }

    phones.push(phone);

    if (writeFixedOtpPhones(phones)) {
        console.log(`✓ Successfully added ${phone} to fixed OTP list`);
        console.log(`✓ File: ${fixedOtpPhonesPath}`);
        console.log(`✓ Total fixed OTP numbers: ${phones.length}`);
        console.log(`\n📱 This number can now use OTP code: ${FIXED_OTP_CODE}`);
        console.log(`⚠ Restart the server for changes to take effect.`);
    } else {
        console.error("❌ Failed to update fixed_otp_phones.txt");
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
