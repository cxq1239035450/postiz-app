"""Initialize new deployment secrets on the target server, without printing them."""
import os
import secrets
from pathlib import Path

os.umask(0o077)
root = Path(__file__).resolve().parent
config = root / 'config'
config.mkdir(exist_ok=True)
if (root / '.env').exists() or (config / '.env').exists():
    raise SystemExit('Existing configuration found; refusing to overwrite secrets.')
database = secrets.token_hex(32)
temporal = secrets.token_hex(32)
(root / '.env').write_text(f'POSTGRES_PASSWORD={database}\nTEMPORAL_PASSWORD={temporal}\n')
values = {
    'MAIN_URL': 'https://qpublush.io',
    'FRONTEND_URL': 'https://qpublush.io',
    'NEXT_PUBLIC_BACKEND_URL': 'https://qpublush.io/api',
    'BACKEND_INTERNAL_URL': 'http://localhost:3000',
    'DATABASE_URL': f'postgresql://postiz:{database}@postgres:5432/postiz',
    'REDIS_URL': 'redis://redis:6379',
    'TEMPORAL_ADDRESS': 'temporal:7233',
    'JWT_SECRET': secrets.token_hex(64),
    'STORAGE_PROVIDER': 'local',
    'UPLOAD_DIRECTORY': '/uploads',
    'NEXT_PUBLIC_UPLOAD_DIRECTORY': '/uploads',
    'IS_GENERAL': 'true',
    'DISABLE_REGISTRATION': 'true',
    'AI_SETTINGS_FILE': '/config/.env',
    'NX_ADD_PLUGINS': 'false',
}
(config / '.env').write_text(''.join(f"{key}='{value}'\n" for key, value in values.items()))
with (config / '.env').open('a') as env_file:
    env_file.write('\n' + (root / 'social.env.example').read_text(encoding='utf-8'))
print('New deployment configuration created. Registration is disabled; no third-party keys copied.')
