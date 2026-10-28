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

**Field NoData**:
A field cell with no usable meteorological value, either because the source marks it missing or because an agreed rule for that quantity and its units rejects it. It represents a gap consistently across map display and numerical use.
_Avoid_: Treating every zero as missing, or confusing a missing value with a value outside the colour scale.

**Published layer**:
A named map representation of a meteorological quantity whose available runs, times and levels can be selected.
_Avoid_: Treating a styled map image as the underlying numerical field.

**Colour-scale range**:
The bounds used to assign colours to visible field values. Values deliberately hidden by a portrayal rule can remain valid numerical data while being excluded from these bounds.
_Avoid_: Equating colour-scale bounds with the minimum and maximum of all valid numerical values.

**Source-grid CRS**:
The coordinate reference system that gives geographic meaning to a field's native grid, including the shape of the Earth and any rotation of the grid axes.
_Avoid_: Equating native-grid coordinates with WGS84 coordinates or the web-map display projection.

**Publication revision**:
An identified published state of a run's available data. A new revision can add forecast times or correct earlier data without creating a new model run.

**Publication withdrawal**:
The removal of a publication revision from availability to consumers, including discovery and access through previously issued references. Withdrawal does not imply immediate physical deletion of its stored data.

**Numeric display tile**:
A spatially bounded set of field values and validity information delivered for map display for a specified published selection.
_Avoid_: Treating display values as canonical native-cell samples or equating a coloured map image with numerical data.

**Forecast point series**:
A sequence of forecast values for one geographic point and field over the valid times of one model run and publication revision. Missing values remain explicit gaps; this series does not represent historical observations.
_Avoid_: Mixing model runs or publication revisions, or calling earlier forecast times observations.

**Wind direction**:
The geographic direction from which the wind blows. The direction of airflow is the opposite direction and is the direction indicated by map arrows.
_Avoid_: Confusing the meteorological wind direction with the direction in which air moves or with the orientation of the map on screen.

**Wind barb**:
A traditional wind symbol whose shaft points toward the direction from which the wind blows, with feathers and pennants indicating speed in knots. Exact point-forecast speed remains available separately in metres per second.
_Avoid_: Reading the shaft as an arrow pointing in the direction of airflow.

## Product scope

**Wind overlay**:
A representation of wind speed and direction that can be enabled independently of the selected meteorological field, allowing both to be viewed together.
_Avoid_: Treating the wind overlay as an alternative to the selected field.

**Web-map display projection**:
The representation of a published field and its geographic context on the web map. Choosing it changes the view while preserving the selected forecast and the meaning of its native-cell values.
_Avoid_: Treating a display choice as a change to the source grid or the external numerical/GIS contract.

**Module**:
A subject-area capability of the system, such as meteorology, hydrology or long-term forecasting.
_Avoid_: Treating every model or display layer as a separate module.

**API consumer organization**:
An external organization whose access and usage are accounted for separately from other organizations and anonymous visitors to the public map.
