# Deployment Guide - Easypanel

## Prerequisites

1. Easypanel account and server
2. Firebase project with Firestore and Authentication enabled
3. Firebase Admin SDK service account key

## Environment Variables

Set these in Easypanel's environment variables section:

### Client-side (Public)
```
NEXT_PUBLIC_FIREBASE_API_KEY=your-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
```

### Server-side (Private)
```
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

**IMPORTANT**: The `FIREBASE_PRIVATE_KEY` must have `\n` replaced with actual newlines or be properly escaped.

## Easypanel Setup

1. Create a new **App** service in Easypanel
2. Select **GitHub** as source (or upload the code)
3. Set **Build Command**: `npm run build`
4. Set **Start Command**: `node server.js`
5. Set **Port**: `3000`
6. Add all environment variables
7. Enable **HTTPS** with Let's Encrypt

### Using Dockerfile (Recommended)

1. Create a new **App** service
2. Select **Dockerfile** as build method
3. The Dockerfile is already configured in the project root
4. Add all environment variables as **Build Args** (for NEXT_PUBLIC_*) and **Environment Variables** (for server-side)

## Firebase Security Rules

1. Go to Firebase Console > Firestore Database > Rules
2. Copy the contents of `firestore.rules` from this project
3. Publish the rules

## Post-Deployment

1. Run the seed script locally to populate initial data:
   ```bash
   npm run seed
   ```

2. Default users created by seed:
   - Admin: `admin@loja.com` / `admin123`
   - Owner 1: `proprietario1@loja.com` / `prop123`
   - Owner 2: `proprietario2@loja.com` / `prop123`
   - Cashier: `caixa@loja.com` / `caixa123`

## Security Checklist

- [x] All API routes require authentication
- [x] Role-based access control (ADMIN, OWNER, CASHIER)
- [x] Firebase security rules configured
- [x] Environment variables not exposed in code
- [x] .env file in .gitignore
- [x] HTTPS enabled via Easypanel

## Troubleshooting

### "Missing or insufficient permissions"
- Check Firebase security rules are deployed
- Verify user is authenticated before making API calls

### "Unauthorized" errors
- Ensure the user is logged in
- Check that the auth token is being sent with requests

### Build fails with Firebase errors
- Ensure all NEXT_PUBLIC_* variables are set as build args
- Check that FIREBASE_PRIVATE_KEY is properly formatted
