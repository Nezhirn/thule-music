async def test_errors_carry_a_stable_code(client, admin):
    resp = await client.post("/auth/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401
    assert resp.json() == {"code": "invalid_credentials", "detail": "Invalid username or password"}

    resp = await client.get("/auth/me")
    assert resp.status_code == 401
    assert resp.json()["code"] == "not_authenticated"
    assert resp.headers["www-authenticate"] == "Bearer"

    resp = await client.get("/auth/me", headers={"Authorization": "Bearer nope"})
    assert resp.json()["code"] == "invalid_token"

    resp = await client.get("/albums/00000000-0000-0000-0000-000000000000", headers=admin)
    assert resp.status_code == 404
    assert resp.json()["code"] == "album_not_found"


async def test_framework_errors_use_the_same_shape(client, admin):
    resp = await client.get("/no-such-route")
    assert resp.status_code == 404
    assert resp.json()["code"] == "not_found"

    resp = await client.delete("/health")
    assert resp.status_code == 405
    assert resp.json()["code"] == "method_not_allowed"

    resp = await client.get("/albums?limit=0", headers=admin)
    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "validation_error"
    assert body["detail"][0]["loc"] == ["query", "limit"]
    assert body["detail"][0]["type"] == "greater_than_equal"


async def test_openapi_documents_the_error_shape(client):
    spec = (await client.get("http://test/openapi.json")).json()
    login = spec["paths"]["/api/v1/auth/login"]["post"]["responses"]
    assert login["4XX"]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorOut")
    assert "422" not in login
    codes = spec["components"]["schemas"]["ErrorCode"]["enum"]
    assert {"invalid_credentials", "track_not_found", "validation_error"} <= set(codes)


async def test_openapi_operation_ids_are_function_names(client):
    spec = (await client.get("http://test/openapi.json")).json()
    ids = [op["operationId"] for path in spec["paths"].values() for op in path.values()]
    assert len(ids) == len(set(ids))
    assert {"login", "list_albums", "get_stream_url", "stream_track", "health"} <= set(ids)
