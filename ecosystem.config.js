module.exports = {
  apps: [{
    name         : 'rekam-api',
    cwd          : '/opt/rekam/apps/backend',
    script       : 'dist/server.js',
    instances    : 'max',           // cluster semua core CPU
    exec_mode    : 'cluster',
    env_file     : '.env.production',
    max_memory_restart : '1G',
    error_file   : '/var/log/rekam/pm2-error.log',
    out_file     : '/var/log/rekam/pm2-out.log',
    log_date_format : 'YYYY-MM-DD HH:mm:ss Z',
    restart_delay: 3000,
  }]
};
