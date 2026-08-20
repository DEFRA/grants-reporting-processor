# grants-reporting-processor

A grants reporting processor that processes raw JSON events into structured CSV reports.

## Language

**Reporting processor**
The service that reads raw events from s3 storage and processes them into structured CSV files.
_Avoid_: File processor, Static file server

**Raw events**
The files used as input, that lead to rows of structured data.
_Avoid_: Input files, Input JSON

**Output CSV**
A file that holds the processed rows derived from the raw events.
_Avoid_: Processed event, Processed file, File
