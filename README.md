# Circuits Practice Platform

A self-hosted circuits practice website for ECE students.

## File structure

```
circuits-practice/
├── index.html          ← Main HTML shell (open this in a browser)
├── css/
│   └── styles.css      ← All visual styles (dark purple theme)
├── js/
│   ├── auth.js         ← Storage, DB, login/register/logout
│   ├── practice.js     ← Practice view, SVG circuits, problem cards
│   ├── blog.js         ← Blog reader and rich text editor
│   ├── editor.js       ← Problem editor, folders, assignments editor
│   ├── assignments.js  ← Student assignment view and submission
│   ├── admin.js        ← Analytics and grade tables
│   └── app.js          ← View routing and bootstrap
└── README.md
```

## How to run locally

Just open `index.html` in any modern browser.
No server, no build step, no dependencies to install.

> **Note:** Storage uses the `window.storage` API provided by the
> Claude.ai artifact environment. If you want to self-host outside
> Claude.ai, swap `window.storage` in `auth.js` → `saveDB` /
> `loadDB` for `localStorage`:
>
> ```js
> // Save
> localStorage.setItem('cpdb_v6', JSON.stringify(DB));
> // Load
> const raw = localStorage.getItem('cpdb_v6');
> if (raw) DB = JSON.parse(raw);
> ```

## Admin account

Default credentials:
- **Username:** `WillowPichardo`
- **Password:** `WillowPichardo`

Change your password in Admin → My account after first login.

## Features

| Feature | Details |
|---|---|
| Auth | SHA-256 hashed passwords, register/login, admin flag |
| Practice | 4 built-in topics (KVL, Voltage divider, Thévenin, Nodal) |
| Custom problems | Variable substitution with `{VarName}` syntax, formula auto-grading |
| Topic folders | Group authored problems, shown in practice sidebar |
| Enable/disable | Hide problems from free practice (still usable in assignments) |
| Assignments | Open/due datetimes, per-problem point values, late flagging |
| Blog | Rich text editor, 4 preset categories + custom tags, draft/published |
| Admin panel | Analytics, assignment grade tables, user management |

## Variable substitution syntax

In question text and hints, wrap variable names in curly braces:

```
Three resistors R1, R2, R3 are in series with a source of {Vs} V.
R1 = {R1} kΩ, R2 = {R2} kΩ, R3 = {R3} kΩ.
Find the voltage across R2.
```

Plain `R1` stays as text; `{R1}` gets replaced with the randomised value.

In the **formula field**, use bare variable names (no braces):

```
Vs * R2 / (R1 + R2 + R3)
```
