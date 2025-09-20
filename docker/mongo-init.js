// MongoDB initialization script for AIOgames
// This creates the application database and user

db = db.getSiblingDB('aiogames');

// Create application user with read/write permissions
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

// Create initial collections with validation
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email', 'password', 'createdAt'],
      properties: {
        email: {
          bsonType: 'string',
          description: 'must be a string and is required'
        },
        password: {
          bsonType: 'string',
          description: 'must be a string and is required'
        },
        name: {
          bsonType: 'string',
          description: 'must be a string if the field exists'
        },
        role: {
          bsonType: 'string',
          enum: ['user', 'admin'],
          description: 'can only be user or admin'
        },
        createdAt: {
          bsonType: 'date',
          description: 'must be a date and is required'
        }
      }
    }
  }
});

db.createCollection('trackedgames', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'title', 'source', 'createdAt'],
      properties: {
        userId: {
          bsonType: 'objectId',
          description: 'must be an ObjectId and is required'
        },
        title: {
          bsonType: 'string',
          description: 'must be a string and is required'
        },
        source: {
          bsonType: 'string',
          description: 'must be a string and is required'
        },
        gameId: {
          bsonType: 'string',
          description: 'must be a string if the field exists'
        },
        image: {
          bsonType: 'string',
          description: 'must be a string if the field exists'
        },
        createdAt: {
          bsonType: 'date',
          description: 'must be a date and is required'
        }
      }
    }
  }
});

// Create indexes for better performance
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ createdAt: 1 });

db.trackedgames.createIndex({ userId: 1 });
db.trackedgames.createIndex({ title: 1 });
db.trackedgames.createIndex({ createdAt: 1 });
db.trackedgames.createIndex({ userId: 1, gameId: 1 });

print('AIOgames database initialization completed successfully!');