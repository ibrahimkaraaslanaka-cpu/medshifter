/**
 * Create Admin Script
 * Usage: node scripts/create-admin.js <username> <password> [name] [superadmin]
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log('Usage: node scripts/create-admin.js <username> <password> [name] [superadmin]');
        console.log('');
        console.log('Arguments:');
        console.log('  username    - Admin username (required)');
        console.log('  password    - Admin password, min 8 characters (required)');
        console.log('  name        - Display name (optional)');
        console.log('  superadmin  - Pass "superadmin" to create a superadmin (optional)');
        console.log('');
        console.log('Example:');
        console.log('  node scripts/create-admin.js admin securepass123 "Main Admin" superadmin');
        process.exit(1);
    }

    const [username, password, name, roleArg] = args;

    if (password.length < 8) {
        console.error('Error: Password must be at least 8 characters');
        process.exit(1);
    }

    const role = roleArg === 'superadmin' ? 'superadmin' : 'admin';

    try {
        // Check if username exists
        const existing = await prisma.admin.findUnique({
            where: { username: username.toLowerCase() }
        });

        if (existing) {
            console.error(`Error: Username "${username}" already exists`);
            process.exit(1);
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create admin
        const admin = await prisma.admin.create({
            data: {
                username: username.toLowerCase(),
                passwordHash,
                name: name || null,
                role
            }
        });

        console.log('');
        console.log('✅ Admin created successfully!');
        console.log('');
        console.log('  ID:', admin.id);
        console.log('  Username:', admin.username);
        console.log('  Name:', admin.name || '(not set)');
        console.log('  Role:', admin.role);
        console.log('');
        console.log('You can now login at: http://localhost:8888/admin-login.html');

    } catch (error) {
        console.error('Error creating admin:', error.message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
