import type { OrgUnitView } from '@lankadws/contracts'
import { describe, expect, it } from 'vitest'
import { createOrganizationMapLayout, createOrganizationOutline } from './OrganizationMap'

function unit(id: string, parentId: string | null, sortOrder: number): OrgUnitView {
  return {
    id,
    companyId: 'cmp_lankadws',
    parentId,
    name: id,
    description: null,
    manager: null,
    activeEmployeeCount: 0,
    childCount: 0,
    sortOrder,
    version: 1,
  }
}

describe('organization map layout', () => {
  it('positions an arbitrarily deep branch below each parent', () => {
    const units = [
      unit('root', null, 10),
      unit('level-2', 'root', 10),
      unit('level-3', 'level-2', 10),
      unit('level-4', 'level-3', 10),
      unit('level-5', 'level-4', 10),
    ]
    const layout = createOrganizationMapLayout(units)

    expect(layout.byId.size).toBe(units.length)
    for (let index = 1; index < units.length; index += 1) {
      expect(layout.byId.get(units[index]!.id)!.y).toBeGreaterThan(layout.byId.get(units[index - 1]!.id)!.y)
    }
    expect(layout.height).toBeGreaterThan(700)
  })

  it('keeps sibling order stable and centers a parent over its children', () => {
    const layout = createOrganizationMapLayout([
      unit('root', null, 10),
      unit('right', 'root', 20),
      unit('left', 'root', 10),
    ])
    const left = layout.byId.get('left')!
    const right = layout.byId.get('right')!
    const root = layout.byId.get('root')!

    expect(left.x).toBeLessThan(right.x)
    expect(root.x).toBe((left.x + right.x) / 2)
    expect(layout.company.x).toBe(root.x)
  })

  it('builds a compact expandable outline in the same stable order', () => {
    const units = [
      unit('root', null, 10),
      unit('right', 'root', 20),
      unit('left', 'root', 10),
      unit('nested', 'left', 10),
    ]

    expect(createOrganizationOutline(units, new Set(['root'])).map((row) => row.unit.id)).toEqual(['root', 'left', 'right'])
    expect(createOrganizationOutline(units, new Set(['root', 'left'])).map((row) => row.unit.id)).toEqual(['root', 'left', 'nested', 'right'])
  })
})
