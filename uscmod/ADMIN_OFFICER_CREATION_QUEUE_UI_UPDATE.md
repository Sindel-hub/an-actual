# Admin Officer Creation + Registration Queue UI Update

- Added browser-based officer account provisioning from the System Administrator dashboard.
- Officer accounts receive a school-issued temporary password, Student ID/institutional-email login aliases, USC position, and printable/downloadable login slip.
- A Firebase verification email is sent to the officer institutional email before privileged login.
- Firestore rules allow trusted admins to create school-provisioned student or officer profiles, never admin profiles.
- Rebuilt Registration Queue into a responsive queue workspace with search/filter controls, selected-state highlighting, mobile-friendly metadata, and officer-position dropdown.
