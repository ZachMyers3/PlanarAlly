import os
import sys
import configparser

from planarserver import app, start_socket, start_http, start_https
from app import logger
from config import config


if __name__ == "__main__":
    socket = config.get("Webserver", "socket", fallback=None)
    if socket:
        start_socket(socket)
    else:
        host = config.get("Webserver", "host")
        port = os.environ.get("PORT")
        if not port:
            port = 8000
        print(f'port: {port}')
        if config.getboolean("Webserver", "ssl"):
            try:
                chain = config.get("Webserver", "ssl_fullchain")
                key = config.get("Webserver", "ssl_privkey")
            except configparser.NoOptionError:
                logger.critical(
                    "SSL CONFIGURATION IS NOT CORRECTLY CONFIGURED. ABORTING LAUNCH."
                )
                sys.exit(2)

            start_https(host, port, chain, key)
        else:
            start_http(host, port)
