// Generated from the backend's OpenAPI schema by `npm run api:types`. Do not edit.

export interface paths {
    "/api/v1/auth/setup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Setup Status
         * @description Public. Whether the server still has no accounts (then `register` creates the admin).
         */
        get: operations["get_setup_status"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Register
         * @description The very first user bootstraps the server and becomes admin.
         *     After that, only admins can create accounts.
         */
        post: operations["register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Login
         * @description After too many failed attempts for a username, answers 429 with Retry-After without
         *     checking the password.
         */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refresh Tokens
         * @description Rotates the refresh token. The new one is derived from it: presenting the old one
         *     again while the new one was never used (the answer lost: the page closed, the network
         *     gone mid-exchange) gets the same answer again, instead of signing the user out. Once
         *     the new one was used, the old one showing up again is treated as theft: every session
         *     of that user is revoked (unless that use was in the last REFRESH_REUSE_GRACE:
         *     `refresh_token_rotated`). A token revoked by logout or a password change is just
         *     rejected.
         */
        post: operations["refresh_tokens"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Logout */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Me */
        get: operations["get_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Me */
        patch: operations["update_me"];
        trace?: never;
    };
    "/api/v1/auth/me/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Change Password
         * @description Signs out every other session (their refresh tokens are revoked; access tokens
         *     expire within minutes) and returns fresh tokens for this one.
         */
        post: operations["change_password"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/me/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Upload Avatar
         * @description JPEG/PNG/WebP. Served like covers: `/covers/{avatar_id}?size=64|300|600`.
         */
        put: operations["upload_avatar"];
        post?: never;
        /** Delete Avatar */
        delete: operations["delete_avatar"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Users
         * @description Oldest first, so the first administrator leads.
         */
        get: operations["list_users"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{username}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete User */
        delete: operations["delete_user"];
        options?: never;
        head?: never;
        /** Update User */
        patch: operations["update_user"];
        trace?: never;
    };
    "/api/v1/users/{username}/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reset Password
         * @description Sets a new password for a user and signs out all their sessions.
         */
        post: operations["reset_password"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{username}/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Sign Out User
         * @description Signs the user out on every device (an access token already issued keeps working
         *     until it expires, within minutes).
         */
        delete: operations["sign_out_user"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/artists": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Artists */
        get: operations["list_artists"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/artists/{artist_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Artist */
        get: operations["get_artist"];
        put?: never;
        post?: never;
        /**
         * Delete Artist
         * @description Deletes from the disk the files of the artist's tracks and of their albums (and the
         *     folders left without music). Tracks of others that only feature them stay: the artist
         *     leaves their tags ("feat." in titles too). To keep the tracks, give them to another
         *     artist instead: rename_artist with that one's name.
         */
        delete: operations["delete_artist"];
        options?: never;
        head?: never;
        /**
         * Rename Artist
         * @description Renames the artist in the tags of every track crediting them and every track of
         *     their albums ("feat." in titles too). Given another artist's name, they are merged into
         *     that one (the result has its id), their albums with the same titles too.
         */
        patch: operations["rename_artist"];
        trace?: never;
    };
    "/api/v1/albums": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Albums */
        get: operations["list_albums"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/albums/{album_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Album */
        get: operations["get_album"];
        put?: never;
        post?: never;
        /**
         * Delete Album
         * @description `tracks=delete` deletes the album's files from the disk (and the folders left without
         *     music). `tracks=singles` keeps them: each becomes a single of its artist, titled after
         *     it. Returns the singles.
         */
        delete: operations["delete_album"];
        options?: never;
        head?: never;
        /**
         * Update Album
         * @description Renames the album, changes its artist, year or genre: in its tracks' tags. Given the
         *     title and artist of another album, it is merged into that one (the result has its id).
         */
        patch: operations["update_album"];
        trace?: never;
    };
    "/api/v1/tracks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Tracks */
        get: operations["list_tracks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tracks/{track_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Track */
        get: operations["get_track"];
        put?: never;
        post?: never;
        /**
         * Delete Track
         * @description Deletes the track's file (and its lyrics files) from the disk.
         */
        delete: operations["delete_track"];
        options?: never;
        head?: never;
        /**
         * Update Track
         * @description Changes the track's title, artists, number or disc: in its file's tags.
         */
        patch: operations["update_track"];
        trace?: never;
    };
    "/api/v1/genres": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Genres
         * @description Album genres, most albums first. Spellings differing only in case count as one.
         */
        get: operations["list_genres"];
        put?: never;
        post?: never;
        /**
         * Delete Genre
         * @description `albums=keep` takes the genre off its albums' tracks; `albums=delete` deletes their
         *     files from the disk (and the folders left without music).
         */
        delete: operations["delete_genre"];
        options?: never;
        head?: never;
        /**
         * Rename Genre
         * @description Renames the genre in the tags of its albums' tracks. The name of another genre merges
         *     the two.
         */
        patch: operations["rename_genre"];
        trace?: never;
    };
    "/api/v1/library/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Library Stats */
        get: operations["get_library_stats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/library/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Last Scan
         * @description The latest scan: waiting, running or finished. Null before the first one.
         */
        get: operations["get_last_scan"];
        put?: never;
        /**
         * Start Scan
         * @description Queues a scan of the library folder; when one is already waiting or running, that
         *     one is returned instead.
         */
        post: operations["start_scan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/library/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Jobs
         * @description Newest first.
         */
        get: operations["list_jobs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/library/jobs/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Job Summary
         * @description Progress of background work, for a scan/import indicator. `since` counts only jobs
         *     created after that moment (e.g. when the client started a scan).
         */
        get: operations["get_job_summary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/library/jobs/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Retry Failed Jobs
         * @description Runs every failed job again, from its first attempt.
         */
        post: operations["retry_failed_jobs"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/library/jobs/{job_id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Retry Job
         * @description Runs a failed job again, from its first attempt. The failed one is replaced.
         */
        post: operations["retry_job"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/library/jobs/failed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Clear Failed Jobs
         * @description Forgets the failed jobs (they would be cleaned up after 30 days anyway).
         */
        delete: operations["clear_failed_jobs"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/library/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload Files
         * @description Saves files into `<library>/uploads/<folder>/` and queues the audio ones for import.
         *     Besides audio, an album's cover image (cover.jpg, folder.png, ...) and lyrics files
         *     (.lrc, .txt) are taken: `folder` keeps an album's files together, e.g. "Artist/Album"
         *     for a dropped album folder. A file already in the library byte for byte is not saved
         *     again. Results are in the order of the files.
         */
        post: operations["upload_files"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/library/uploads/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Get Import Status
         * @description How the import of each file is going (files as `upload_files` returned them), in
         *     the order asked. A POST only so that many long paths fit.
         */
        post: operations["get_import_status"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/albums/{album_id}/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set Album Cover
         * @description JPEG, PNG or WebP up to 20 MB. Scans keep it whatever the album's files hold, until
         *     `DELETE` gives it up.
         */
        put: operations["set_album_cover"];
        post?: never;
        /**
         * Reset Album Cover
         * @description Gives up the cover an admin chose: the album's files have the say again (a folder
         *     image, else embedded art).
         */
        delete: operations["reset_album_cover"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tracks/{track_id}/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set Track Cover
         * @description The track's own picture, shown instead of its album's cover wherever the track is
         *     (lists, the player, playlists' mosaics). JPEG, PNG or WebP up to 20 MB.
         */
        put: operations["set_track_cover"];
        post?: never;
        /**
         * Reset Track Cover
         * @description The track shows its album's cover again.
         */
        delete: operations["reset_track_cover"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/artists/{artist_id}/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set Artist Cover
         * @description The artist's picture, instead of their newest album's cover. JPEG, PNG or WebP up to
         *     20 MB. Kept on the server: the files have no place for it.
         */
        put: operations["set_artist_cover"];
        post?: never;
        /**
         * Reset Artist Cover
         * @description The artist shows their newest album's cover again.
         */
        delete: operations["reset_artist_cover"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/albums/{album_id}/tracks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload To Album
         * @description Adds an audio file to the album: saved beside its tracks, tagged as one of them (the
         *     album, its artist, year and genre; the next number if it has none) and imported at
         *     once. MP3, FLAC, Ogg, Opus or M4A: the formats whose tags can be written.
         */
        post: operations["upload_to_album"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/artists/{artist_id}/tracks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload To Artist
         * @description Adds an audio file to the artist's album titled `album`, as upload_to_album does. With
         *     no such album yet, it is a new one: the file goes to "<artist>/<album>/", tagged with the
         *     title, the artist, and `year` and `genre` if given.
         */
        post: operations["upload_to_artist"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tracks/move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move Tracks
         * @description Moves tracks into another album: their files go beside its tracks (with their
         *     lyrics files) and are tagged as its own. Returns that album.
         */
        post: operations["move_tracks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/albums/move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Move Albums
         * @description Gives albums to another artist, one of the library or a new one: in their tracks'
         *     tags the album artist changes, and so does the track artist where it was the album's
         *     ("feat." in titles too). An album with the title of one of theirs is merged into it. The
         *     files stay where they are. Returns that artist.
         */
        post: operations["move_albums"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/albums/genre": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set Albums Genre
         * @description Moves albums into a genre, one of the library or a new one: in their tracks' tags.
         *     Returns that genre.
         */
        post: operations["set_albums_genre"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tracks/{track_id}/stream-url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Stream Url
         * @description Returns a signed URL that plays without an Authorization header. It is relative to
         *     the server (`/api/v1/tracks/...`): an absolute one would be built from the request's
         *     Host and scheme, which a reverse proxy may not pass through.
         *
         *     The URL is pinned to a rendition that exists right now: if the requested transcode is
         *     not ready yet, it points at the original. Otherwise a transcode finishing mid-playback
         *     would make later Range requests read a different file.
         */
        get: operations["get_stream_url"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tracks/{track_id}/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Stream Track
         * @description Streams audio with HTTP Range support. Auth: Bearer header or `exp`+`sig` from
         *     `/stream-url`. `high`/`low` fall back to the original until the transcode is ready.
         */
        get: operations["stream_track"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/covers/{cover_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Cover
         * @description Public (no auth) so `<img src>` works; ids are unguessable UUIDs.
         */
        get: operations["get_cover"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tracks/{track_id}/lyrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Lyrics */
        get: operations["get_lyrics"];
        /**
         * Set Lyrics
         * @description Admins write a track's lyrics, or take wrong ones away (empty text). They stay
         *     whatever the files or LRCLIB say, until `DELETE` gives them up. Returns the lyrics as
         *     `GET` does; null when the track now has none.
         */
        put: operations["set_lyrics"];
        post?: never;
        /**
         * Find Lyrics Again
         * @description Forgets the track's lyrics, an admin's included, and looks for them again as an
         *     import does (lyrics file, tags, LRCLIB) in the background.
         */
        delete: operations["find_lyrics_again"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/playlists": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Playlists */
        get: operations["list_playlists"];
        put?: never;
        /** Create Playlist */
        post: operations["create_playlist"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/playlists/{playlist_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Playlist */
        get: operations["get_playlist"];
        put?: never;
        post?: never;
        /** Delete Playlist */
        delete: operations["delete_playlist"];
        options?: never;
        head?: never;
        /** Update Playlist */
        patch: operations["update_playlist"];
        trace?: never;
    };
    "/api/v1/playlists/{playlist_id}/tracks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add Playlist Tracks */
        post: operations["add_playlist_tracks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/playlists/{playlist_id}/tracks/{item_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove Playlist Item */
        delete: operations["remove_playlist_item"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/playlists/{playlist_id}/move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Move Playlist Item */
        post: operations["move_playlist_item"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/likes/tracks/{track_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Like Track */
        put: operations["like_track"];
        post?: never;
        /** Unlike Track */
        delete: operations["unlike_track"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/likes/tracks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Liked Tracks
         * @description The virtual "Liked Music" playlist, newest first.
         */
        get: operations["list_liked_tracks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/likes/albums/{album_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Like Album */
        put: operations["like_album"];
        post?: never;
        /** Unlike Album */
        delete: operations["unlike_album"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/likes/albums": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Liked Albums
         * @description Saved albums, newest first.
         */
        get: operations["list_liked_albums"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/likes/artists/{artist_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Like Artist */
        put: operations["like_artist"];
        post?: never;
        /** Unlike Artist */
        delete: operations["unlike_artist"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/likes/artists": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Liked Artists
         * @description Followed artists, newest first.
         */
        get: operations["list_liked_artists"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/plays": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Record Play
         * @description Scrobble. Clients should send it once a track was played for ~30s or half its length.
         */
        post: operations["record_play"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/recent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Recent Tracks
         * @description Recently played tracks, each listed once (latest play).
         */
        get: operations["list_recent_tracks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List History
         * @description Every play, newest first. Paged by the last play of the previous page (`before`), so
         *     plays recorded while the list is read don't shift the pages.
         */
        get: operations["list_history"];
        put?: never;
        post?: never;
        /**
         * Clear History
         * @description Forgets every play: history, "Recently played", and what "For you" learnt from them.
         */
        delete: operations["clear_history"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Preferences */
        get: operations["get_preferences"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Preferences */
        patch: operations["update_preferences"];
        trace?: never;
    };
    "/api/v1/home": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Home */
        get: operations["get_home"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Search
         * @description Artists, albums and tracks matching `q`, closest first; `type` asks for one kind
         *     only, paged with `limit` and `offset`. Albums and tracks match their artist's name too
         *     ("katatonia" lists their albums and tracks).
         */
        get: operations["search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AddTracksIn */
        AddTracksIn: {
            /** Track Ids */
            track_ids: string[];
            /** Position */
            position?: number | null;
        };
        /**
         * AlbumDeletion
         * @enum {string}
         */
        AlbumDeletion: "delete" | "singles";
        /** AlbumDetail */
        AlbumDetail: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Title */
            title: string;
            /** Year */
            year: number | null;
            /** Genre */
            genre: string | null;
            artist: components["schemas"]["ArtistRef"];
            /** Cover Id */
            cover_id: string | null;
            cover_palette: components["schemas"]["CoverPalette"] | null;
            /**
             * Added At
             * Format: date-time
             */
            added_at: string;
            /**
             * Liked
             * @default false
             */
            liked: boolean;
            /** Duration Ms */
            duration_ms: number;
            /**
             * Cover Custom
             * @default false
             */
            cover_custom: boolean;
            /** Tracks */
            tracks: components["schemas"]["TrackOut"][];
        };
        /** AlbumOut */
        AlbumOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Title */
            title: string;
            /** Year */
            year: number | null;
            /** Genre */
            genre: string | null;
            artist: components["schemas"]["ArtistRef"];
            /** Cover Id */
            cover_id: string | null;
            cover_palette: components["schemas"]["CoverPalette"] | null;
            /**
             * Added At
             * Format: date-time
             */
            added_at: string;
            /**
             * Liked
             * @default false
             */
            liked: boolean;
        };
        /** AlbumPatch */
        AlbumPatch: {
            /** Title */
            title?: string | null;
            /** Artist */
            artist?: string | null;
            /** Year */
            year?: number | null;
            /** Genre */
            genre?: string | null;
        };
        /** AlbumRef */
        AlbumRef: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Title */
            title: string;
            /** Cover Id */
            cover_id: string | null;
            cover_palette: components["schemas"]["CoverPalette"] | null;
        };
        /**
         * AlbumSort
         * @enum {string}
         */
        AlbumSort: "added" | "title" | "year" | "artist";
        /** AlbumUpload */
        AlbumUpload: {
            track: components["schemas"]["TrackOut"];
            /**
             * Duplicate
             * @default false
             */
            duplicate: boolean;
        };
        /** AlbumsGenre */
        AlbumsGenre: {
            /** Album Ids */
            album_ids: string[];
            /** Genre */
            genre: string;
        };
        /** AlbumsMove */
        AlbumsMove: {
            /** Album Ids */
            album_ids: string[];
            /** Artist */
            artist: string;
        };
        /** ArtistDetail */
        ArtistDetail: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Cover Id */
            cover_id: string | null;
            cover_palette: components["schemas"]["CoverPalette"] | null;
            /** Album Count */
            album_count: number;
            /**
             * Liked
             * @default false
             */
            liked: boolean;
            /**
             * Cover Custom
             * @default false
             */
            cover_custom: boolean;
            /** Albums */
            albums: components["schemas"]["AlbumOut"][];
            /** Appears On */
            appears_on: components["schemas"]["AlbumOut"][];
            /** Top Tracks */
            top_tracks: components["schemas"]["TrackOut"][];
        };
        /** ArtistOut */
        ArtistOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Cover Id */
            cover_id: string | null;
            cover_palette: components["schemas"]["CoverPalette"] | null;
            /** Album Count */
            album_count: number;
            /**
             * Liked
             * @default false
             */
            liked: boolean;
        };
        /** ArtistPatch */
        ArtistPatch: {
            /** Name */
            name: string;
        };
        /** ArtistRef */
        ArtistRef: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
        };
        /** Body_set_album_cover */
        Body_set_album_cover: {
            /** File */
            file: string;
        };
        /** Body_set_artist_cover */
        Body_set_artist_cover: {
            /** File */
            file: string;
        };
        /** Body_set_track_cover */
        Body_set_track_cover: {
            /** File */
            file: string;
        };
        /** Body_upload_avatar */
        Body_upload_avatar: {
            /** File */
            file: string;
        };
        /** Body_upload_files */
        Body_upload_files: {
            /** Files */
            files: string[];
            /**
             * Folder
             * @default
             */
            folder?: string;
        };
        /** Body_upload_to_album */
        Body_upload_to_album: {
            /** File */
            file: string;
        };
        /** Body_upload_to_artist */
        Body_upload_to_artist: {
            /** File */
            file: string;
            /** Album */
            album: string;
            /** Year */
            year?: number | null;
            /** Genre */
            genre?: string | null;
        };
        /**
         * CoverPalette
         * @description Colours of a cover, for tinting the UI after it (#rrggbb).
         */
        CoverPalette: {
            /** Average */
            average: string;
            /** Dominant */
            dominant: string;
            /** Muted */
            muted: string;
            /** Vibrant */
            vibrant: string | null;
            /** Luminance */
            luminance: number;
        };
        /** Credentials */
        Credentials: {
            /** Username */
            username: string;
            /** Password */
            password: string;
        };
        /**
         * ErrorCode
         * @enum {string}
         */
        ErrorCode: "bad_request" | "forbidden" | "not_found" | "method_not_allowed" | "validation_error" | "http_error" | "internal_error" | "service_unavailable" | "conflict" | "not_authenticated" | "invalid_token" | "admin_only" | "registration_closed" | "username_taken" | "invalid_credentials" | "too_many_login_attempts" | "invalid_refresh_token" | "refresh_token_rotated" | "refresh_token_reused" | "refresh_token_expired" | "user_not_found" | "cannot_delete_self" | "cannot_change_own_role" | "wrong_password" | "not_an_image" | "image_too_large" | "artist_not_found" | "album_not_found" | "track_not_found" | "not_an_audio_file" | "tags_not_writable" | "unknown_albums" | "genre_not_found" | "invalid_stream_signature" | "audio_file_missing" | "cover_not_found" | "cover_file_missing" | "invalid_cover_size" | "lyrics_not_found" | "job_not_found" | "library_not_writable" | "library_unavailable" | "disk_full" | "name_too_long" | "playlist_not_found" | "playlist_item_not_found" | "unknown_tracks";
        /** ErrorOut */
        ErrorOut: {
            code: components["schemas"]["ErrorCode"];
            /** Detail */
            detail: string | components["schemas"]["ValidationIssue"][];
        };
        /**
         * GenreDeletion
         * @enum {string}
         */
        GenreDeletion: "keep" | "delete";
        /** GenreOut */
        GenreOut: {
            /** Name */
            name: string;
            /** Album Count */
            album_count: number;
        };
        /** GenrePatch */
        GenrePatch: {
            /** Name */
            name: string;
        };
        /** History */
        History: {
            /** Items */
            items: components["schemas"]["Play"][];
            /** Next */
            next: string | null;
        };
        /** HomeOut */
        HomeOut: {
            /** Recently Added */
            recently_added: components["schemas"]["AlbumOut"][];
            /** New Releases */
            new_releases: components["schemas"]["AlbumOut"][];
            /** Recently Played */
            recently_played: components["schemas"]["AlbumOut"][];
            /** For You */
            for_you: components["schemas"]["AlbumOut"][];
        };
        /**
         * ImportState
         * @enum {string}
         */
        ImportState: "queued" | "importing" | "imported" | "failed" | "missing";
        /** ImportStatus */
        ImportStatus: {
            /** Path */
            path: string;
            state: components["schemas"]["ImportState"];
            /** Error */
            error: string | null;
            track: components["schemas"]["TrackOut"] | null;
        };
        /** ImportStatusIn */
        ImportStatusIn: {
            /** Paths */
            paths: string[];
        };
        /** JobCounts */
        JobCounts: {
            /**
             * Queued
             * @default 0
             */
            queued: number;
            /**
             * Running
             * @default 0
             */
            running: number;
            /**
             * Done
             * @default 0
             */
            done: number;
            /**
             * Failed
             * @default 0
             */
            failed: number;
        };
        /** JobOut */
        JobOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Kind */
            kind: string;
            status: components["schemas"]["JobStatus"];
            /** Payload */
            payload: {
                [key: string]: unknown;
            };
            /** Attempts */
            attempts: number;
            /** Max Attempts */
            max_attempts: number;
            /** Error */
            error: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Finished At */
            finished_at: string | null;
            /** Subject */
            subject: string | null;
        };
        /**
         * JobStatus
         * @enum {string}
         */
        JobStatus: "queued" | "running" | "done" | "failed";
        /** JobSummary */
        JobSummary: {
            /** Kinds */
            kinds: {
                [key: string]: components["schemas"]["JobCounts"];
            };
            /** Pending */
            pending: number;
            /** Failed */
            failed: number;
        };
        /** LibraryStats */
        LibraryStats: {
            /** Artists */
            artists: number;
            /** Albums */
            albums: number;
            /** Tracks */
            tracks: number;
            /** Duration Ms */
            duration_ms: number;
            /** Size Bytes */
            size_bytes: number;
        };
        /** LyricLine */
        LyricLine: {
            /** Time Ms */
            time_ms: number;
            /** Text */
            text: string;
        };
        /** LyricsIn */
        LyricsIn: {
            /**
             * Text
             * @default
             */
            text?: string;
            /**
             * Instrumental
             * @default false
             */
            instrumental?: boolean;
        };
        /** LyricsOut */
        LyricsOut: {
            /**
             * Track Id
             * Format: uuid
             */
            track_id: string;
            /** Source */
            source: string;
            /** Instrumental */
            instrumental: boolean;
            /** Synced */
            synced: boolean;
            /** Lines */
            lines: components["schemas"]["LyricLine"][];
            /** Plain */
            plain: string | null;
        };
        /** MoveIn */
        MoveIn: {
            /**
             * Item Id
             * Format: uuid
             */
            item_id: string;
            /** Position */
            position: number;
        };
        /** NewAlbum */
        NewAlbum: {
            /** Title */
            title: string;
            /** Artist */
            artist: string;
        };
        /** Page[AlbumOut] */
        Page_AlbumOut_: {
            /** Items */
            items: components["schemas"]["AlbumOut"][];
            /** Total */
            total: number;
            /** Limit */
            limit: number;
            /** Offset */
            offset: number;
        };
        /** Page[ArtistOut] */
        Page_ArtistOut_: {
            /** Items */
            items: components["schemas"]["ArtistOut"][];
            /** Total */
            total: number;
            /** Limit */
            limit: number;
            /** Offset */
            offset: number;
        };
        /** Page[JobOut] */
        Page_JobOut_: {
            /** Items */
            items: components["schemas"]["JobOut"][];
            /** Total */
            total: number;
            /** Limit */
            limit: number;
            /** Offset */
            offset: number;
        };
        /** Page[TrackOut] */
        Page_TrackOut_: {
            /** Items */
            items: components["schemas"]["TrackOut"][];
            /** Total */
            total: number;
            /** Limit */
            limit: number;
            /** Offset */
            offset: number;
        };
        /** PasswordChange */
        PasswordChange: {
            /** Current Password */
            current_password: string;
            /** New Password */
            new_password: string;
        };
        /** PasswordReset */
        PasswordReset: {
            /** New Password */
            new_password: string;
        };
        /** Play */
        Play: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Played At
             * Format: date-time
             */
            played_at: string;
            track: components["schemas"]["TrackOut"];
        };
        /** PlayIn */
        PlayIn: {
            /**
             * Track Id
             * Format: uuid
             */
            track_id: string;
            /** Played At */
            played_at?: string | null;
            /** Listened Ms */
            listened_ms?: number | null;
        };
        /** PlaylistDetail */
        PlaylistDetail: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Description */
            description: string | null;
            /** Track Count */
            track_count: number;
            /** Duration Ms */
            duration_ms: number;
            /** Cover Ids */
            cover_ids: string[];
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Items */
            items: components["schemas"]["PlaylistItemOut"][];
        };
        /** PlaylistIn */
        PlaylistIn: {
            /** Name */
            name: string;
            /** Description */
            description?: string | null;
        };
        /** PlaylistItemOut */
        PlaylistItemOut: {
            /**
             * Item Id
             * Format: uuid
             */
            item_id: string;
            /** Position */
            position: number;
            /**
             * Added At
             * Format: date-time
             */
            added_at: string;
            track: components["schemas"]["TrackOut"];
        };
        /** PlaylistOut */
        PlaylistOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Name */
            name: string;
            /** Description */
            description: string | null;
            /** Track Count */
            track_count: number;
            /** Duration Ms */
            duration_ms: number;
            /** Cover Ids */
            cover_ids: string[];
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** PlaylistPatch */
        PlaylistPatch: {
            /** Name */
            name?: string | null;
            /** Description */
            description?: string | null;
        };
        /** Preferences */
        Preferences: {
            /** Language */
            language: ("ru" | "en") | null;
            /** Accent Color */
            accent_color: string | null;
            /**
             * Blur
             * @default true
             */
            blur: boolean;
            /**
             * Adaptive Color
             * @default true
             */
            adaptive_color: boolean;
            /** @default high */
            stream_quality: components["schemas"]["Quality"];
        };
        /**
         * PreferencesPatch
         * @description Changes only the fields that are sent; `null` resets a field to its default.
         */
        PreferencesPatch: {
            /** Language */
            language?: ("ru" | "en") | null;
            /** Accent Color */
            accent_color?: string | null;
            /** Blur */
            blur?: boolean | null;
            /** Adaptive Color */
            adaptive_color?: boolean | null;
            stream_quality?: components["schemas"]["Quality"] | null;
        };
        /** ProfilePatch */
        ProfilePatch: {
            /** Display Name */
            display_name?: string | null;
        };
        /**
         * Quality
         * @enum {string}
         */
        Quality: "original" | "high" | "low";
        /** RecentTrack */
        RecentTrack: {
            /**
             * Played At
             * Format: date-time
             */
            played_at: string;
            track: components["schemas"]["TrackOut"];
        };
        /** RefreshIn */
        RefreshIn: {
            /** Refresh Token */
            refresh_token: string;
        };
        /** RegisterIn */
        RegisterIn: {
            /** Username */
            username: string;
            /** Password */
            password: string;
            /** Display Name */
            display_name?: string | null;
            /** @default user */
            role?: components["schemas"]["Role"];
        };
        /** RetryResult */
        RetryResult: {
            /** Retried */
            retried: number;
        };
        /**
         * Role
         * @enum {string}
         */
        Role: "admin" | "user";
        /** ScanIn */
        ScanIn: {
            /**
             * Remove Missing
             * @default false
             */
            remove_missing?: boolean;
        };
        /** ScanOut */
        ScanOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            status: components["schemas"]["JobStatus"];
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Finished At */
            finished_at: string | null;
            /** Error */
            error: string | null;
            result: components["schemas"]["ScanResult"] | null;
            imports: components["schemas"]["JobCounts"];
        };
        /**
         * ScanResult
         * @description What a scan found, in files. Added and updated ones were queued for import: the
         *     import goes on after the scan is done (see the job summary).
         */
        ScanResult: {
            /** Files */
            files: number;
            /** Added */
            added: number;
            /** Updated */
            updated: number;
            /** Moved */
            moved: number;
            /** Removed */
            removed: number;
            /**
             * Missing
             * @default 0
             */
            missing: number;
            /**
             * Unreadable
             * @default 0
             */
            unreadable: number;
        };
        /** SearchOut */
        SearchOut: {
            /** Artists */
            artists: components["schemas"]["ArtistOut"][];
            /** Albums */
            albums: components["schemas"]["AlbumOut"][];
            /** Tracks */
            tracks: components["schemas"]["TrackOut"][];
        };
        /**
         * SearchType
         * @enum {string}
         */
        SearchType: "artists" | "albums" | "tracks";
        /** SetupStatus */
        SetupStatus: {
            /** Needs Setup */
            needs_setup: boolean;
        };
        /** StreamUrl */
        StreamUrl: {
            /** Url */
            url: string;
            quality: components["schemas"]["Quality"];
            /** Codec */
            codec: string;
            /** Bitrate */
            bitrate: number | null;
            /**
             * Expires At
             * Format: date-time
             */
            expires_at: string;
        };
        /** TokenPair */
        TokenPair: {
            /** Access Token */
            access_token: string;
            /** Refresh Token */
            refresh_token: string;
            /**
             * Token Type
             * @default bearer
             */
            token_type: string;
            /** Expires In */
            expires_in: number;
        };
        /** TrackMove */
        TrackMove: {
            /** Track Ids */
            track_ids: string[];
            /** Album Id */
            album_id?: string | null;
            new_album?: components["schemas"]["NewAlbum"] | null;
        };
        /** TrackOut */
        TrackOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Title */
            title: string;
            /** Duration Ms */
            duration_ms: number;
            /** Track No */
            track_no: number | null;
            /** Disc No */
            disc_no: number | null;
            /** Codec */
            codec: string;
            /** Bitrate */
            bitrate: number | null;
            artist: components["schemas"]["ArtistRef"];
            /** Artists */
            artists: components["schemas"]["ArtistRef"][];
            album: components["schemas"]["AlbumRef"];
            album_artist: components["schemas"]["ArtistRef"];
            /** Cover Id */
            cover_id: string | null;
            cover_palette: components["schemas"]["CoverPalette"] | null;
            /**
             * Liked
             * @default false
             */
            liked: boolean;
        };
        /** TrackPatch */
        TrackPatch: {
            /** Title */
            title?: string | null;
            /** Artists */
            artists?: string[] | null;
            /** Track No */
            track_no?: number | null;
            /** Disc No */
            disc_no?: number | null;
        };
        /**
         * TrackSort
         * @enum {string}
         */
        TrackSort: "added" | "title" | "artist" | "album";
        /** UploadResult */
        UploadResult: {
            /** Path */
            path: string;
            /**
             * Duplicate
             * @default false
             */
            duplicate: boolean;
        };
        /**
         * UserAdminOut
         * @description A user as administrators see them.
         */
        UserAdminOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Username */
            username: string;
            /** Display Name */
            display_name: string | null;
            role: components["schemas"]["Role"];
            /** Avatar Id */
            avatar_id: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /** Last Seen At */
            last_seen_at: string | null;
            /** Sessions */
            sessions: number;
        };
        /** UserOut */
        UserOut: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Username */
            username: string;
            /** Display Name */
            display_name: string | null;
            role: components["schemas"]["Role"];
            /** Avatar Id */
            avatar_id: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
        };
        /** UserPatch */
        UserPatch: {
            role: components["schemas"]["Role"];
        };
        /** ValidationIssue */
        ValidationIssue: {
            /** Loc */
            loc: (string | number)[];
            /** Msg */
            msg: string;
            /** Type */
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    get_setup_status: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SetupStatus"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Credentials"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenPair"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    refresh_tokens: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefreshIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenPair"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RefreshIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    update_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProfilePatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    change_password: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordChange"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TokenPair"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    upload_avatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_avatar"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    delete_avatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_users: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserAdminOut"][];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    delete_user: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    update_user: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    reset_password: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordReset"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    sign_out_user: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                username: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_artists: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                q?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_ArtistOut_"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_artist: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artist_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArtistDetail"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    delete_artist: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artist_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    rename_artist: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artist_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ArtistPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArtistOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_albums: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                sort?: components["schemas"]["AlbumSort"];
                q?: string | null;
                genre?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_AlbumOut_"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_album: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                album_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlbumDetail"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    delete_album: {
        parameters: {
            query: {
                tracks: components["schemas"]["AlbumDeletion"];
            };
            header?: never;
            path: {
                album_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlbumOut"][];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    update_album: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                album_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AlbumPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlbumOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_tracks: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
                sort?: components["schemas"]["TrackSort"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_TrackOut_"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_track: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrackOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    delete_track: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    update_track: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TrackPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrackOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_genres: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenreOut"][];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    delete_genre: {
        parameters: {
            query: {
                genre: string;
                albums: components["schemas"]["GenreDeletion"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    rename_genre: {
        parameters: {
            query: {
                genre: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenrePatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenreOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_library_stats: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LibraryStats"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_last_scan: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanOut"] | null;
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    start_scan: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ScanIn"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_jobs: {
        parameters: {
            query?: {
                status?: components["schemas"]["JobStatus"] | null;
                kind?: string | null;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_JobOut_"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_job_summary: {
        parameters: {
            query?: {
                since?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobSummary"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    retry_failed_jobs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RetryResult"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    retry_job: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    clear_failed_jobs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    upload_files: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_files"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadResult"][];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_import_status: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportStatusIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportStatus"][];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    set_album_cover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                album_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_set_album_cover"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlbumOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    reset_album_cover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                album_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlbumOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    set_track_cover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_set_track_cover"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrackOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    reset_track_cover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TrackOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    set_artist_cover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artist_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_set_artist_cover"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArtistOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    reset_artist_cover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artist_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArtistOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    upload_to_album: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                album_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_to_album"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlbumUpload"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    upload_to_artist: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artist_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_to_artist"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlbumUpload"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    move_tracks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TrackMove"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AlbumOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    move_albums: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AlbumsMove"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ArtistOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    set_albums_genre: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AlbumsGenre"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenreOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_stream_url: {
        parameters: {
            query?: {
                quality?: components["schemas"]["Quality"];
            };
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StreamUrl"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    stream_track: {
        parameters: {
            query?: {
                quality?: components["schemas"]["Quality"];
                exp?: number | null;
                sig?: string | null;
            };
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_cover: {
        parameters: {
            query?: {
                /** @description One of (64, 300, 600); omit for full size */
                size?: number | null;
            };
            header?: never;
            path: {
                cover_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_lyrics: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LyricsOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    set_lyrics: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LyricsIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LyricsOut"] | null;
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    find_lyrics_again: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_playlists: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlaylistOut"][];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    create_playlist: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlaylistIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlaylistDetail"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_playlist: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                playlist_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlaylistDetail"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    delete_playlist: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                playlist_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    update_playlist: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                playlist_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlaylistPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlaylistDetail"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    add_playlist_tracks: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                playlist_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddTracksIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlaylistDetail"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    remove_playlist_item: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                playlist_id: string;
                item_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlaylistDetail"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    move_playlist_item: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                playlist_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MoveIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlaylistDetail"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    like_track: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    unlike_track: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                track_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_liked_tracks: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_TrackOut_"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    like_album: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                album_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    unlike_album: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                album_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_liked_albums: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_AlbumOut_"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    like_artist: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artist_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    unlike_artist: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                artist_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_liked_artists: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Page_ArtistOut_"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    record_play: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlayIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_recent_tracks: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RecentTrack"][];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    list_history: {
        parameters: {
            query?: {
                limit?: number;
                before?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["History"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    clear_history: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_preferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preferences"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    update_preferences: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferencesPatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Preferences"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    get_home: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HomeOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    search: {
        parameters: {
            query: {
                q: string;
                limit?: number;
                offset?: number;
                type?: components["schemas"]["SearchType"] | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchOut"];
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
    health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
            /** @description Error */
            "4XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorOut"];
                };
            };
        };
    };
}
