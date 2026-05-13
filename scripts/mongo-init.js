// MongoDB initialization script for development
// Creates the application DATABASE LOGIN (Mongo user "aiogames") — not Next.js app users.
// Admin accounts for the app are created from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME
// when the Next.js server starts (see src/lib/seedAdmin.ts) or via POST /api/admin/seed (dev).

db = db.getSiblingDB('aiogames');

// Create application user
db.createUser({
  user: 'aiogames',
  pwd: 'aiogames123',
  roles: [
    {
      role: 'readWrite',
      db: 'aiogames'
    }
  ]
});

print('✅ Created aiogames database and user');
print('📊 Database: aiogames');
print('👤 User: aiogames');
print('🔗 Connection string: mongodb://aiogames:aiogames123@localhost:27017/aiogames');