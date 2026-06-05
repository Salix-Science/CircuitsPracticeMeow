# Circuits Practice

Hello team! This welcome to the github of the circuitspractice website. I hope you guys are enjoying the content and has atleast helped in some way!


## Verification
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
