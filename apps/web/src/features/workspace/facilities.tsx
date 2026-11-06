"use client";

import type { WorkspaceFacility } from "@lotse/brain/workspace/schema";
import { type JSX, useMemo, useState } from "react";
import { DEFAULT_RADIUS_KM, KM_DECIMALS, MAX_RADIUS_KM } from "./config.ts";
import type { WorkspaceCopy } from "./copy.ts";
import { type Coordinates, filterFacilities } from "./facility-filter.ts";
import { FacilityMap } from "./facility-map.tsx";
import styles from "./workspace.module.css";

export function FacilitySources({
  facility,
  copy,
}: {
  facility: WorkspaceFacility;
  copy: WorkspaceCopy;
}): JSX.Element {
  return (
    <div className={styles.source}>
      <p>
        {copy.asOf} <time dateTime={facility.asOf}>{facility.asOf}</time>
      </p>
      {facility.sources.map((source) => (
        <details key={source.url}>
          <summary>{copy.source}</summary>
          <a href={source.url} target="_blank" rel="noreferrer">
            {new URL(source.url).hostname}
          </a>
          <blockquote>{source.quote}</blockquote>
          <p>
            {copy.retrieved}{" "}
            <time dateTime={source.retrieved_at}>{source.retrieved_at.slice(0, 10)}</time>
          </p>
        </details>
      ))}
    </div>
  );
}

export function FacilityContacts({
  facility,
  copy,
}: {
  facility: WorkspaceFacility;
  copy: WorkspaceCopy;
}): JSX.Element {
  return (
    <div className={styles.actions}>
      {facility.phone && (
        <a href={`tel:${facility.phone.replace(/[^+\d]/g, "")}`}>
          {copy.phone}: {facility.phone}
        </a>
      )}
      {facility.email && (
        <a href={`mailto:${facility.email}`}>
          {copy.email}: {facility.email}
        </a>
      )}
      {facility.url && (
        <a href={facility.url} target="_blank" rel="noreferrer">
          {copy.website}
        </a>
      )}
      {!facility.phone && !facility.email && !facility.url && <p>{copy.noChannels}</p>}
    </div>
  );
}

export function WorkspaceFacilities({
  facilities,
  caseId,
  benefitId,
  copy,
}: {
  facilities: WorkspaceFacility[];
  caseId?: string;
  benefitId?: string;
  copy: WorkspaceCopy;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS_KM);
  const [locationState, setLocationState] = useState<"idle" | "loading" | "error">("idle");
  const [mapEnabled, setMapEnabled] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const filtered = useMemo(
    () => filterFacilities(facilities, query, type, origin, radius),
    [facilities, query, type, origin, radius],
  );
  const types = [...new Set(facilities.map((entry) => entry.type))];
  function locate(): void {
    setLocationState("loading");
    if (!navigator.geolocation) {
      setLocationState("error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLocationState("idle");
      },
      () => setLocationState("error"),
    );
  }
  return (
    <>
      <div className={styles.toolbar}>
        <div className={styles.field}>
          <label htmlFor="facility-query">{copy.search}</label>
          <input
            id="facility-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="facility-type">{copy.type}</label>
          <select id="facility-type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">{copy.allTypes}</option>
            {types.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.toolbar}>
        <button type="button" onClick={locate} disabled={locationState === "loading"}>
          {locationState === "loading" ? copy.locating : copy.locate}
        </button>
        {origin && (
          <div className={styles.field}>
            <label htmlFor="radius">{copy.radius}</label>
            <input
              id="radius"
              type="number"
              min={1}
              max={MAX_RADIUS_KM}
              value={radius}
              onChange={(event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value) && value > 0 && value <= MAX_RADIUS_KM) setRadius(value);
              }}
            />
          </div>
        )}
      </div>
      {locationState === "error" && <p role="status">{copy.locationError}</p>}
      {mapEnabled ? (
        <FacilityMap
          facilities={filtered}
          selectedId={selectedId}
          onSelect={setSelectedId}
          copy={copy}
        />
      ) : (
        <div className={styles.mapPlaceholder}>
          <p>{copy.mapPrivacy}</p>
          <button type="button" onClick={() => setMapEnabled(true)}>
            {copy.enableMap}
          </button>
        </div>
      )}
      {filtered.some((facility) => !facility.location) && (
        <p className={styles.muted}>{copy.noCoordinates}</p>
      )}
      {filtered.length ? (
        <ul className={`${styles.list} ${styles.grid}`}>
          {filtered.map((facility) => (
            <li
              key={facility.id}
              className={styles.card}
              aria-current={selectedId === facility.id ? "true" : undefined}
            >
              <h2>{facility.title}</h2>
              <p>{facility.address || facility.region}</p>
              <p>{facility.services.join(" · ")}</p>
              <p>
                {facility.distanceKm === null
                  ? copy.noDistance
                  : `${copy.distance}: ${facility.distanceKm.toFixed(KM_DECIMALS)} km`}
              </p>
              <p>{facility.openingHours ?? copy.noHours}</p>
              {facility.accessibility && (
                <p>
                  {copy.access}: {facility.accessibility}
                </p>
              )}
              <FacilityContacts facility={facility} copy={copy} />
              <div className={styles.actions}>
                {facility.location && (
                  <button
                    type="button"
                    onClick={() => {
                      setMapEnabled(true);
                      setSelectedId(facility.id);
                    }}
                  >
                    {copy.showOnMap}
                  </button>
                )}
                {caseId && (
                  <a
                    href={`/appointments?caseId=${encodeURIComponent(caseId)}&facilityId=${encodeURIComponent(facility.id)}${benefitId ? `&benefitId=${encodeURIComponent(benefitId)}` : ""}`}
                  >
                    {copy.prepare}
                  </a>
                )}
              </div>
              <FacilitySources facility={facility} copy={copy} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>{copy.noFacilities}</p>
      )}
    </>
  );
}
