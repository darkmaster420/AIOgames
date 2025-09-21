// MongoDB initialization script for development
// Creates the application user and database

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