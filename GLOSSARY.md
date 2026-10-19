# Hydrometcenter data publication

Shared language for the meteorology prototype and its future subject-area modules.

## Meteorological data

**Model**:
A named forecasting product that produces meteorological fields on a defined spatial domain. Different products may have different grids, variables and update schedules.

**Model run**:
A forecast production cycle identified by its model and reference time. A run can contain many fields and can become available in parts.
_Avoid_: Using a file or a valid time as a synonym for a run.

**Reference time**:
The time from which a model run's forecast lead times are measured.
_Avoid_: Treating ingestion time as the forecast reference time.

**Valid time**:
The time for which a forecast value applies. An interval-based product also has validity bounds and aggregation semantics.

**Forecast lead time**:
The offset from a run's reference time to a forecast's valid time.

**Field**:
A spatial set of values for one meteorological quantity, model run, valid time or interval, and vertical surface or level, with a specified grid and ensemble member where applicable.
_Avoid_: Assuming every temperature field represents air temperature at two metres.

**Published layer**:
A named map representation of a meteorological quantity whose available runs, times and levels can be selected.
_Avoid_: Treating a styled map image as the underlying numerical field.

**Publication revision**:
An identified published state of a run's available data. A new revision can add forecast times or correct earlier data without creating a new model run.

## Product scope

**Module**:
A subject-area capability of the system, such as meteorology, hydrology or long-term forecasting.
_Avoid_: Treating every model or display layer as a separate module.

**API consumer organization**:
An external organization whose access and usage are accounted for separately from other organizations and anonymous visitors to the public map.
