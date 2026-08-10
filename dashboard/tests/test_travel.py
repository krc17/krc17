"""Weather and traffic parsing, against sample API payloads (no network).

These lock the shapes we depend on from NWS and TomTom so a field rename or a
null we didn't expect fails here, not silently on the wall."""
from __future__ import annotations

from backend.config import _parse_routes
from backend.sources import routing as R
from backend.sources import tides as TD
from backend.sources import traffic as T
from backend.sources import weather as W


def test_weather_period_parse():
    period = W._period({
        "name": "Today", "temperature": 88, "temperatureUnit": "F",
        "shortForecast": "Sunny", "detailedForecast": "Sunny and hot",
        "probabilityOfPrecipitation": {"value": 20},
        "windSpeed": "10 mph", "windDirection": "SW", "isDaytime": True,
    })
    assert period["temp"] == 88 and period["unit"] == "F"
    assert period["short"] == "Sunny" and period["precip"] == 20
    assert "10 mph" in period["wind"] and "SW" in period["wind"]
    assert period["isDaytime"] is True


def test_weather_period_handles_null_precip():
    # NWS sends probabilityOfPrecipitation.value = null routinely.
    assert W._period({"probabilityOfPrecipitation": {"value": None}})["precip"] is None
    assert W._period({})["precip"] is None


def test_weather_alert_parse():
    alert = W._alert({
        "event": "Coastal Flood Warning", "severity": "Severe",
        "headline": "Flooding likely this afternoon", "ends": "2026-08-07T22:00:00Z",
    })
    assert alert["event"] == "Coastal Flood Warning"
    assert alert["severity"] == "Severe"
    assert alert["headline"].startswith("Flooding")


def test_traffic_incident_parse():
    incident = T._incident({"properties": {
        "iconCategory": 1, "magnitudeOfDelay": 3,
        "events": [{"description": "Accident, right lane blocked", "code": 401}],
        "from": "I-26 E", "to": "Exit 212", "roadNumbers": ["I-26"],
        "delay": 420, "length": 800,
    }})
    assert incident["type"] == "Accident"
    assert incident["road"] == "I-26"
    assert incident["description"].startswith("Accident")
    assert incident["delay"] == 420 and incident["magnitude"] == 3


def test_traffic_drops_unsurfaced_category():
    # iconCategory 2 = fog: covered by the weather panel, not the drive list.
    assert T._incident({"properties": {"iconCategory": 2}}) is None


def test_traffic_road_falls_back_when_unnumbered():
    incident = T._incident({"properties": {"iconCategory": 6, "from": "US-17 N at Mt Pleasant"}})
    assert incident["type"] == "Traffic jam"
    assert incident["road"] == "US-17 N at Mt Pleasant"


def test_traffic_no_key_is_graceful():
    snapshot = T.TrafficService("", "-80,32,-79,33").snapshot
    assert snapshot["configured"] is False
    assert snapshot["incidents"] == [] and snapshot["count"] == 0


def test_parse_routes(monkeypatch):
    monkeypatch.setenv(
        "TRAVEL_ROUTES",
        "HQ to Awendaw = 32.78,-79.93 > 33.03,-79.62; "
        "junk without arrow = 1,2; "
        "Downtown = 32.78,-79.93 > 32.80,-79.94",
    )
    routes = _parse_routes("TRAVEL_ROUTES")
    assert [r["name"] for r in routes] == ["HQ to Awendaw", "Downtown"]  # junk dropped
    assert routes[0]["from"] == "32.78,-79.93" and routes[0]["to"] == "33.03,-79.62"


def test_routing_not_configured_without_key_or_routes():
    # A key but no routes, or routes but no key, both count as not configured.
    assert R.RoutingService("k", []).snapshot["configured"] is False
    assert R.RoutingService("", [{"name": "a", "from": "1,2", "to": "3,4"}]).snapshot["configured"] is False


def test_tide_parse():
    high = TD._tide({"t": "2026-08-07 13:15", "v": "5.234", "type": "H"})
    assert high["type"] == "High" and high["height"] == 5.2
    assert high["time"].startswith("2026-08-07T13:15")
    low = TD._tide({"t": "2026-08-07 19:40", "v": "0.51", "type": "L"})
    assert low["type"] == "Low" and low["height"] == 0.5
    assert TD._tide({"t": "not-a-time"}) is None      # malformed rows are skipped


def test_tides_no_station_is_graceful():
    assert TD.TidesService("").snapshot["configured"] is False
