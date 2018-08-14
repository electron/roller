[![Build Status](https://travis-ci.com/electron/roller.svg?branch=master)](https://travis-ci.com/electron/roller)

# Roller

> a service that automates the process of upstreaming changes in libchromiumcontent
to the submodule reference in the main electron repository

## Setup

```sh
# Install dependencies
npm install

# Run the service
npm start
```

## Documentation

This service has no user facing interfaces or commands, PRs that land into release
branches of `libchromiumcontent` will be automatically PRed as submodule updates
into `electron/electron`.
