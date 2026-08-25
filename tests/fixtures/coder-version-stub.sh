#!/usr/bin/env bash
# Emit the exact public Coder build identity supported by manifest.env.
printf '%s\n' 'Coder v2.31.6+f765029'
# Emit the public upstream commit URL used by the deployment guard.
printf '%s\n' 'https://github.com/coder/coder/commit/f7650296ceb9b020c79cd525ac7bd3c7f252ae1d'
