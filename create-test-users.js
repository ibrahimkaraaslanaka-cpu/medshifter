// Create test users for authorization testing
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createTestUsers() {
    const password = await bcrypt.hash('Test123456', 12);

    const users = [
        { email: 'free@test.com', name: 'Free Test User', plan: 'FREE' },
        { email: 'individual@test.com', name: 'Individual Test User', plan: 'INDIVIDUAL' },
        { email: 'business@test.com', name: 'Business Test User', plan: 'BUSINESS' }
    ];

    for (const u of users) {
        try {
            const existing = await prisma.user.findUnique({ where: { email: u.email } });
            if (existing) {
                await prisma.user.update({
                    where: { email: u.email },
                    data: { plan: u.plan }
                });
                console.log(`Updated: ${u.email} -> ${u.plan} (id: ${existing.id})`);
            } else {
                const created = await prisma.user.create({
                    data: { email: u.email, passwordHash: password, name: u.name, plan: u.plan }
                });
                console.log(`Created: ${u.email} -> ${u.plan} (id: ${created.id})`);
            }
        } catch (error) {
            console.error(`Error for ${u.email}:`, error.message);
        }
    }

    await prisma.$disconnect();
    console.log('Done!');
}

createTestUsers().catch(console.error);
