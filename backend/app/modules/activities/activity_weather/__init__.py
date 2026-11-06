"""Activity Open-Meteo weather, off the ingestion path.

Stores the hour at the activity start (temperature, humidity, wind) the same way
Dreeve does, using Open-Meteo. The ``activity.created`` subscriber fetches it;
the scheduled backfill fills activities imported before this fork change.
"""
