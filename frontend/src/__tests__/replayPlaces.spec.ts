import { describe, expect, it } from 'vitest'

import {
  PLACE_HIDE_M,
  PLACE_SHOW_M,
  overpassQuery,
  parseOverpassPlaces,
  pickVisiblePlace,
  placeCaption,
  routeBbox,
  type ReplayPlace,
} from '@/features/activities/replay/replayPlaces'

const town: ReplayPlace = {
  id: 'town:1',
  name: 'Eger',
  kind: 'town',
  lat: 47.9,
  lng: 20.37,
}

const peak: ReplayPlace = {
  id: 'peak:2',
  name: 'Nagy-Eged',
  kind: 'peak',
  ele: 536.4,
  lat: 47.91,
  lng: 20.4,
}

describe('routeBbox', () => {
  it('pads the track', () => {
    const box = routeBbox([
      { lat: 47.9, lng: 20.37 },
      { lat: 47.91, lng: 20.4 },
    ])
    expect(box).not.toBeNull()
    if (!box) {
      return
    }
    expect(box.south).toBeLessThan(47.9)
    expect(box.north).toBeGreaterThan(47.91)
    expect(box.west).toBeLessThan(20.37)
    expect(box.east).toBeGreaterThan(20.4)
  })
})

describe('overpassQuery', () => {
  it('asks for towns and peaks in the box', () => {
    const query = overpassQuery({ south: 1, west: 2, north: 3, east: 4 })
    expect(query).toContain('node["place"~"city|town|village|hamlet|suburb"](1,2,3,4)')
    expect(query).toContain('node["natural"="peak"](1,2,3,4)')
  })
})

describe('parseOverpassPlaces', () => {
  it('keeps named towns and peaks', () => {
    const places = parseOverpassPlaces({
      elements: [
        { type: 'node', id: 1, lat: 47.9, lon: 20.37, tags: { name: 'Eger', place: 'town' } },
        {
          type: 'node',
          id: 2,
          lat: 47.91,
          lon: 20.4,
          tags: { name: 'Nagy-Eged', natural: 'peak', ele: '536.4' },
        },
        { type: 'node', id: 3, lat: 1, lon: 2, tags: { place: 'village' } },
      ],
    })
    expect(places).toEqual([
      {
        id: 'town:1',
        name: 'Eger',
        kind: 'town',
        settlement: 'town',
        lat: 47.9,
        lng: 20.37,
      },
      { id: 'peak:2', name: 'Nagy-Eged', kind: 'peak', ele: 536.4, lat: 47.91, lng: 20.4 },
    ])
  })
})

describe('pickVisiblePlace', () => {
  it('shows under 400 m and holds until 600 m', () => {
    const here = { lat: 47.9, lng: 20.37 }
    expect(pickVisiblePlace(here, [town], null)?.id).toBe('town:1')
    const far = { lat: 47.9 + PLACE_SHOW_M / 111_320, lng: 20.37 }
    expect(pickVisiblePlace(far, [town], town)?.id).toBe('town:1')
    const gone = { lat: 47.9 + (PLACE_HIDE_M + 50) / 111_320, lng: 20.37 }
    expect(pickVisiblePlace(gone, [town], town)).toBeNull()
  })
})

describe('placeCaption', () => {
  it('formats a peak and a village', () => {
    expect(placeCaption(peak)).toEqual({
      icon: '⛰️',
      title: 'Nagy-Eged',
      subtitle: '536 M • CSÚCS',
    })
    expect(placeCaption(town)).toEqual({ icon: '📍', title: 'Eger', subtitle: 'VÁROS' })
    expect(placeCaption({ ...town, settlement: 'village', name: 'Dömös' })).toEqual({
      icon: '📍',
      title: 'Dömös',
      subtitle: 'FALU',
    })
    expect(placeCaption({ ...town, settlement: 'hamlet', name: 'Pilisszentlélek' })).toEqual({
      icon: '📍',
      title: 'Pilisszentlélek',
      subtitle: 'FALU',
    })
  })
})
