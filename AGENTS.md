# Testing preferences

- Run application testing in development mode (`MODE=development`) unless the user explicitly requests production testing. Do not start production-mode services or run production-build verification as routine testing.
- Use isolated test databases and stub AI providers for automated integration tests; preserve the user's normal app data.
- Development mode disables account storage and daily/monthly AI quotas. Quota guard tests may enable the enforcement policy as a fixture while the test server remains in development mode.
