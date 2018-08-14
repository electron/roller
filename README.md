[![Build Status](https://img.shields.io/travis/electron/roller.svg)](https://travis-ci.org/electron/roller)

# Roller

> a service that automates the process of upstreaming changes in libchromiumcontent
to the submodule reference in the main electron repository

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Documentation

This service has no user facing interfaces or commands, PRs that land into release
branches of `libchromiumcontent` will be automatically PRed as submodule updates
into `electron/electron`.
