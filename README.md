# JD Run Coaching

Marketing site plus an athlete portal. Plain HTML, CSS and JavaScript, so there is no build step.

- `index.html`: public site. The enquiry form uses Netlify Forms.
- `portal/`: athlete and coach portal (login, weekly plan, run logging, coach dashboard, VDOT paces).
- `supabase/schema.sql`: database tables and security rules.
- `js/config.js`: your Supabase URL and anon key.

## Setup (about 15 minutes)

### 1. Supabase (the database and logins)
1. Create a free project at supabase.com.
2. Open SQL Editor, paste all of `supabase/schema.sql`, and run it.
3. Project Settings > API: copy the Project URL and the anon public key into `js/config.js`. The anon key is meant to be public. The security rules protect the data.
4. Authentication > URL Configuration: set Site URL to your Netlify address (and add it under Redirect URLs).

### 2. Make yourself the coach
1. Open the portal and create an account with your email.
2. In Supabase SQL Editor run, with your email:
   `update public.profiles set role = 'coach' where email = 'you@example.com';`
3. Reload the portal. You will see the Athletes dashboard.
4. When an athlete creates an account, they appear on your dashboard as unassigned. Click Add to my athletes, then open them to set their VDOT and write their weeks.

### 3. Netlify (hosting)
1. Add new site > Import an existing project > GitHub > choose this repo.
2. Leave the build command empty and set the publish directory to `.` (netlify.toml already does this).
3. Enquiries arrive under Forms in the Netlify dashboard. You can add an email notification there.

## Editing the site
Text in yellow-pink highlight in the About and Coaching sections is placeholder. Replace it in `index.html`.

## Notes
- Athletes can see only their own plan and logs. You can see only athletes you have added.
- Paces are calculated from Daniels' VDOT formulas and match his tables to within a couple of seconds.
- Email confirmation is on by default in Supabase. For a small group you can turn it off under Authentication > Providers > Email.
