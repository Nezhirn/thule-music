#!/bin/sh
# Started as root (the default), the image gives the folders the server writes to to
# PUID:PGID and runs the command as that user: host folders mounted into the container just
# work. Started as another user (`user:` in docker-compose.yml), it runs the command as is.
set -eu

if [ "$(id -u)" = 0 ]; then
    owner="$PUID:$PGID"
    # The server's own data: covers, transcodes.
    # Best effort: on some network shares (NFS with root squashed, CIFS) root can't change
    # owners. The server then says itself whether it can write there, and what to do.
    mkdir -p "$THULE_DATA_PATH" || true
    if [ "$(stat -c %u:%g "$THULE_DATA_PATH" 2>/dev/null)" != "$owner" ]; then
        chown -R "$owner" "$THULE_DATA_PATH" 2>/dev/null ||
            echo "entrypoint: couldn't make $owner the owner of $THULE_DATA_PATH" >&2
    fi
    # Uploads go to <library>/uploads. Only a folder made here is given away: the rest of
    # the library, and an uploads folder that is already there, keep their owners.
    uploads="$THULE_LIBRARY_PATH/uploads"
    if [ ! -e "$uploads" ] && mkdir "$uploads" 2>/dev/null; then
        chown "$owner" "$uploads" 2>/dev/null ||
            echo "entrypoint: couldn't make $owner the owner of $uploads" >&2
    fi
    # root's home is closed to that user; looking into it (the Postgres driver checks for
    # client certificates there) would fail.
    export HOME=/nonexistent
    exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
fi
exec "$@"
