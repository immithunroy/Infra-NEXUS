#!/bin/bash
set -e

echo "=== Clean orphaned FieldPhoto records (file missing on disk) ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "
DELETE FROM field_photos
WHERE NOT EXISTS (
    SELECT 1 FROM unnest(ARRAY['subscriber','tj']) AS et
    WHERE storage_key LIKE et || '/%'
)
OR storage_key NOT LIKE 'subscriber/%'
OR storage_key NOT LIKE 'tj/%';
"

echo ""
echo "=== Now check: find records where file doesn't exist ==="
# The storage_key is relative like "subscriber/17051602/overall.jpg"
# Full path = /app/uploads/field-photos/{storage_key}
docker exec infra-nexus-backend python -c "
import os
from sqlalchemy import create_engine, text
import json

engine = create_engine('postgresql://olt:oltpassword@db:5432/infra_nexus')
with engine.connect() as conn:
    rows = conn.execute(text('SELECT id, storage_key FROM field_photos')).fetchall()
    base = '/app/uploads/field-photos/'
    orphaned = []
    for row in rows:
        full = os.path.join(base, row[1])
        exists = os.path.exists(full)
        print(f'  id={row[0]} key={row[1]} exists={exists}')
        if not exists:
            orphaned.append(row[0])
    print(f'Orphaned IDs: {orphaned}')
    if orphaned:
        conn.execute(text(f'DELETE FROM field_photos WHERE id IN ({','.join(str(i) for i in orphaned)})'))
        conn.commit()
        print(f'Deleted {len(orphaned)} orphaned records')
"

echo ""
echo "=== After cleanup ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT id, entity_type, entity_id, photo_type, storage_key FROM field_photos ORDER BY id;"
