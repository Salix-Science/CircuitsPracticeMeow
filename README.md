# Circuits Practice — Firebase Version

## Setup checklist

### 1. Firebase Console steps (one-time)

**Authentication:**
- Build → Authentication → Sign-in method → Email/Password → Enable

**Firestore:**
- Build → Firestore Database → Create database → Start in test mode
- Rules tab → paste contents of `firestore.rules` → Publish

**Make yourself admin:**
After your first login, go to Firestore → users collection →
find your document → click Edit → set `isAdmin: true`

### 2. Deploy to GitHub Pages or Netlify

**GitHub Pages:**
1. Push this folder to a GitHub repo
2. Settings → Pages → Deploy from branch → main → Save
3. Point your Namecheap domain using the A records in the hosting guide

**Netlify:**
1. Drag this folder onto netlify.com
2. Site settings → Domain management → add your domain

### 3. Firebase CORS / Authorised domains

In Firebase Console → Authentication → Settings → Authorised domains:
Add your custom domain (e.g. `yourcircuitssite.com`)
Also add `www.yourcircuitssite.com`

Without this step, login will fail on your custom domain.

## File structure

```
circuits-firebase/
├── index.html          ← Main app shell
├── firestore.rules     ← Paste into Firebase Console → Firestore → Rules
├── css/
│   └── styles.css
└── js/
    ├── firebase.js     ← Firebase init, auth, DB layer (ES module)
    ├── practice.js     ← Practice view and problem cards
    ├── blog.js         ← Blog reader and rich text editor
    ├── editor.js       ← Problem editor, folders, assignments
    ├── assignments.js  ← Student assignment submission
    ├── admin.js        ← Analytics and grade tables
    └── app.js          ← View routing and bootstrap
```

## How login works

Usernames are stored as Firebase Auth emails internally:
`username` → `username@circuitspractice.app`

Students just type their chosen username and password — they never
see the email address. The conversion is transparent.

## Storage model

| Collection   | Contents |
|---|---|
| users        | One doc per user — profile, scores, streak, submissions |
| problems     | One doc per problem |
| posts        | One doc per blog post |
| assignments  | One doc per assignment |
| folders      | One doc per topic folder |

All data is real-time across every device automatically.
