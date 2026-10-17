#!/bin/bash
grep -E "^(ok|not ok)|^    (ok|not ok)" /tmp/p.out
