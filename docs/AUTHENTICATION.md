# Authentication Setup Guide

## Overview
AIOgames uses NextAuth.js for secure authentication with MongoDB Atlas for user storage. All features require user authentication.

## MongoDB Atlas Setup

### Step 1: Create Atlas Account
1. Visit [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Sign up for a free account
3. Create a new project

### Step 2: Create Cluster
1. Click "Create a Deployment"
2. Choose the FREE tier (M0 Sandbox)
3. Select your preferred cloud provider and region
4. Click "Create Deployment"

### Step 3: Database Access
1. Go to "Database Access" in the left sidebar
2. Click "Add New Database User"
3. Choose "Password" authentication
4. Create a username and strong password
5. Grant "Read and write to any database" permissions
6. Click "Add User"

### Step 4: Network Access
1. Go to "Network Access" in the left sidebar
2. Click "Add IP Address"
3. For development: Click "Allow Access from Anywhere" (0.0.0.0/0)
4. For production: Add your specific IP addresses
5. Click "Confirm"

### Step 5: Get Connection String
1. Go to "Database" in the left sidebar
2. Click "Connect" on your cluster
3. Select "Connect your application"
4. Copy the connection string
5. It will look like: `mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`

## Environment Configuration

### Update .env
Replace the placeholders in your `.env` file:

```env
# Replace with your actual Atlas connection string
MONGODB_URI=mongodb+srv://youruser:yourpassword@cluster0.abc123.mongodb.net/aiogames?retryWrites=true&w=majority

# Generate a secure secret (use: openssl rand -base64 32)
NEXTAUTH_SECRET=your-secure-random-string-here

# For development
NEXTAUTH_URL=http://localhost:3000
```

### Generate NextAuth Secret
Run this command to generate a secure secret:
```bash
openssl rand -base64 32
```

Copy the output and use it as your `NEXTAUTH_SECRET`.

## User Management

### Registration Process
1. Users visit `/auth/signup`
2. Provide name, email, and password (6+ characters)
3. System validates email uniqueness
4. Password is hashed with bcrypt (12 rounds)
5. User is automatically signed in after registration

### Login Process
1. Users visit `/auth/signin`
2. Provide email and password
3. System verifies credentials against MongoDB
4. Session is created with JWT strategy
5. User is redirected to main dashboard

### Security Features
- Passwords hashed with bcrypt (salt rounds: 12)
- Session-based authentication with NextAuth.js
- Protected API routes require authentication
- Middleware redirects unauthenticated users to login
- User-specific data isolation (each user sees only their tracked games)

## Database Schema

### User Model
```javascript
{
  email: String (required, unique, lowercase),
  password: String (required, hashed),
  name: String (required),
  createdAt: Date,
  lastLogin: Date,
  preferences: {
    theme: String (light|dark|system),
    notifications: {
      email: Boolean,
      updateFrequency: String (immediate|daily|weekly)
    }
  },
  isActive: Boolean
}
```

### TrackedGame Model (User-Associated)
```javascript
{
  userId: ObjectId (reference to User, required),
  gameId: String (required),
  title: String (required),
  // ... other game fields
}
```

## API Authentication

All API routes (except auth endpoints) require authentication:

```javascript
import { getCurrentUser } from '../../../lib/auth';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Continue with authenticated logic...
}
```

## Protected Routes

The middleware automatically protects all routes except:
- `/auth/signin` - Login page
- `/auth/signup` - Registration page  
- `/api/auth/*` - NextAuth API routes

Unauthenticated users are redirected to `/auth/signin`.

## Troubleshooting

### Common Issues

1. **Connection Error**: 
   - Verify MongoDB Atlas connection string
   - Check IP whitelist in Network Access
   - Ensure database user exists and has permissions

2. **Authentication Not Working**:
   - Verify NEXTAUTH_SECRET is set and secure
   - Check NEXTAUTH_URL matches your domain
   - Ensure MongoDB is accessible

3. **Registration Fails**:
   - Check for duplicate email addresses
   - Verify password meets minimum requirements (6 characters)
   - Check MongoDB connection

4. **Session Issues**:
   - Clear browser cookies/localStorage
   - Restart the application
   - Verify NextAuth configuration

### Debug Mode
Enable debug logging by adding to `.env`:
```env
NEXTAUTH_DEBUG=true
```

### Test Connection
You can test your MongoDB connection by running:
```bash
node -e "require('./src/lib/db.js').default().then(() => console.log('✅ Connected')).catch(e => console.log('❌', e.message))"
```

## Production Deployment

### Environment Variables for Production
```env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/aiogames
NEXTAUTH_URL=https://yourdomain.com
NEXTAUTH_SECRET=your-production-secret-key
NODE_ENV=production
```

### Security Considerations
1. Use strong, unique passwords for MongoDB users
2. Restrict IP access in MongoDB Atlas Network Access
3. Use a secure, random NEXTAUTH_SECRET (minimum 32 characters)
4. Enable HTTPS in production
5. Regularly rotate secrets and passwords
6. Monitor for suspicious authentication attempts

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Verify your `.env` configuration
3. Test your MongoDB Atlas connection
4. Review the console for error messages
5. Check the MongoDB Atlas logs in the Atlas dashboard