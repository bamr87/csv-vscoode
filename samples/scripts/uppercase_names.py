#!/usr/bin/env python3
"""Example external-command step: read CSV from stdin, write CSV to stdout."""
import csv
import sys

reader = csv.DictReader(sys.stdin)
writer = csv.DictWriter(sys.stdout, fieldnames=reader.fieldnames)
writer.writeheader()
for row in reader:
    row["name"] = row["name"].upper()
    writer.writerow(row)
