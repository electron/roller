[![Test](https://github.com/electron/roller/actions/workflows/test.yml/badge.svg)](https://github.com/electron/roller/actions/workflows/test.yml)

# Roller

Roller is a service that automates the process of updating major dependencies in Electron.js

## Setup

```sh
# Clone this repository
git clone https://github.com/electron/roller.git

# Go into the repository
cd roller

# Install dependencies
npm install

# Run the service
npm start
```

## Documentation

This service has no user facing interfaces or commands. Updates to major dependencies
including Node.js and Chromium will be automatically PRed as DEPS updates
into `electron/electron`. Updates to the organization's node orbs will be automatically
PRed into relevant repositories.
