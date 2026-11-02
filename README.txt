OPTIMUS '26 — Website (KPR Institute of Engineering and Technology)
====================================================================

How to run on this laptop
-------------------------
1. Install Node.js (LTS) from https://nodejs.org  (only needed once)
2. Open a terminal / PowerShell inside this folder.
3. Install dependencies (only the first time):
       npm install
4. Start the site:
       npm run dev
5. Open the URL it prints, e.g.  http://localhost:5178/

Music (optional)
----------------
Place a licensed MP3 named  theme.mp3  in the  public\music\  folder
for the background theme. Until then a low ambient drone plays instead.

Files
-----
src\App.tsx      -> the entire website (edit here)
public\music\    -> put theme.mp3 here
package.json     -> project config / dependencies

Note: node_modules is NOT included in this zip on purpose (it is large and
is recreated by "npm install"). That is normal.
