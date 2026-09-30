"""Regenerate the entirely synthetic space-time demonstration (Python stdlib)."""
import csv
from pathlib import Path

out = Path(__file__).parent
sites = [(-72.5, 42.4), (-72.0, 42.2), (-71.5, 42.0), (-71.0, 41.8), (-70.5, 42.3), (-69.8, 43.0)]
rows = []
for year in range(2019, 2025):
    for replicate in range(12):
        lineage = ('Persistent', 'Expanding', 'Reappearing' if year in (2019, 2024) else 'Distinct', 'Distinct')[replicate % 4]
        site = {'Persistent': 0, 'Expanding': min(year - 2019, 3), 'Reappearing': 4, 'Distinct': 5}[lineage]
        lon, lat = sites[site]
        month = 1 + replicate % 12
        raw = str(year) if replicate % 5 == 0 else f'{year}-{month:02}' if replicate % 5 == 1 else f'{year}-{month:02}-17'
        if replicate == 7 and year == 2021:
            raw = '2021-2023'
        rows.append([f'SYN-{len(rows)+1:03}', lat, lon, raw, lineage, lineage, f'Synthetic site {site+1}', 'water' if replicate % 2 else 'sediment', 'Synthetic organism', 'SYNTHETIC', 'Illustrative only; no actual observations, movement or transmission'])
with (out / 'metadata.tsv').open('w', newline='') as f:
    writer = csv.writer(f, delimiter='\t')
    writer.writerow(['sample_id', 'latitude', 'longitude', 'collection_date', 'lineage', 'cluster', 'site', 'isolation_source', 'species', 'data_type', 'notes'])
    writer.writerows(rows)
with (out / 'distances.tsv').open('w', newline='') as f:
    writer = csv.writer(f, delimiter='\t')
    writer.writerow(['sample_id'] + [r[0] for r in rows])
    for i, r in enumerate(rows):
        writer.writerow([r[0]] + [0 if i == j else abs(i-j) % 11 + 1 + (0 if r[4] == other[4] else 100) for j, other in enumerate(rows)])
with (out / 'clusters.tsv').open('w', newline='') as f:
    writer = csv.writer(f, delimiter='\t')
    writer.writerow(['sample_id', 'cluster'])
    writer.writerows((r[0], r[5]) for r in rows)
