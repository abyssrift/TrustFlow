
UX & Performance Enhancements (High Priority)
Focusing on speed, mobile usability, and reducing cognitive load.

Mobile File Handling: Detect OS and stream direct media extensions (images, PDFs, videos) instead of forcing .zip downloads.

Task Management Optimization:

Implement manual card reordering (drag-and-drop) to manage high-volume task lists.

Standardization: Standardize all time units across the frontend and ensure graphs reflect appropriate, consistent time units.

Feature Expansion (Medium Priority)
Additions to improve collaboration, documentation, and organizational clarity.

Task Reversal/Leading: Ability for managers to revert or override task states to correct workflow errors.

Organization & Overwhelm Reduction:

Shared Tasks: Define a system for cross-pipeline cooperation.

Calendar Integration: Visualize tasks in a calendar view to provide a clearer timeline. (a way to change the view from kanban board to calendar in a nice animation, allowing users to organize their thoughts.)

Kanban board: Create better high-level views to prevent users from feeling overwhelmed by too many tasks at once. (Requires thinking it throughly, we need a detailed plan, will take multiple days and weeks of development)

Backend & Automation (Future Roadmap)
Supporting the structural growth of the platform.

Task Automation: Implement automatic archival processes.

Integration/API: Standardize API calls to support cross-pipeline task management and external integrations.

add a sidebar on kanban board like the sidebar on the other side to show everyone who has access to the pipeline as well as other pipeline relative information, the sidebar is always collapsed and only a slight small line is visible on the right, which is connected to a small circular bump at the top where if you hover, the sidebar expands and shows.

allow also users to write personel notes in that sidebar, just things they wanna lookout for, that note system should be like the windows notes application, where you can open multiple notes and view only one, the others stay at the top at a nice selector, modern, sleek and elegant

ON native mobile, clicking an excel sheet in the task brief doesnt open it internally in the app, it just redirects you to the link to download it, which i hope we can add a redirect link to re take you to the app without making it annoying. (maybe get download permissions? i wanna make the download experience seamless for users.)

on desktop web, when you click on a file/excel/picture or whatever that requires me to open it via the storage URL in supabase, open it in another tab rather than the app's tab

Adding Routines as a subcategory of automations in pipeline builder, where tasks can be recurring, some specific tasks can be routed differenlty, etc.

allowing files to be shareable by a one click link and somehow allow for some kind of security ish thing, the link should be auto generatable by filehub, and have a limited expiry date, and RLS policies and similar, that way team members can share links outside the platform easily.

a link for sharing and uploading might also be good but i think it might be complex and require alot.

folders in the filehub get deleted without being soft deleted first, insane bug!

the file too large to load thing should be for 500 KB for mobile, and way higher for desktop, because desktop can get way bigger files.

Selection and bulk actions are not inclusive of folders, i want windows explorer like interactions.

clicking ctrl and clicking a file should select it. 
Dragging a file to a folder while selecting multiple should drag them all to the folder.

The add new folder button that is in the filehub should be added to the header below the tab switcher rather than take up space in the middle, i want it to be like windows explorer.

Whenever there are new files/new activity happening there should be something showing and a number displayed on the icon in the sidebar.

Top bar looks wonderful, but there are features deeply missing.
1. user's profile picture isnt displayed
2. bar should disappear when users scroll down in the page, appear when users scroll up in the same page. 
3. its look is a bit out of place for the tasks.tsx, it just blocks the background, allow for personalization for changing the color to transparent.
4. Allow users to attach 4 shortcuts at the top if they want, it could be shortcuts to specific pipelines or something similar.
5. Get the searchbar to get up and be running, its very important that we get it working to be able to index everything, files in the filehub, reports, tasks, descriptions, dates, i want a very very smart search bar. capable of recognizing when a user is looking for a task, or a date that something specific happened on, etc. (This one requires excessive planning, skip it if you're an AI looking for quick wins)
6. allow the top bar to be retractable completely, showing only a small tip that lets you pull it back down (not really its just a button)

when a new task is added to a pipeline, would it be possible to play a small nice ding sound when the user isnt looking at the app?

Dragging a file into the folder works but dropping it doesnt change anything, i tried it in a channel.