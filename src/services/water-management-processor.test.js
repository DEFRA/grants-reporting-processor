import { describe, it, expect } from 'vitest'
import { processWaterManagementApplication, WATER_MANAGEMENT_COLUMNS } from './water-management-processor.js'

describe('water-management-processor', () => {
  const eventData = {
    eventType: 'APPLICATION_CREATED',
    sbi: '800000002',
    crn: '9000000005',
    applicationId: 'wmg-6bd-ct2',
    applicationReceiptDate: '2026-11-24T16:40:49.270Z',
    applicantName: 'Matilda Test-Stanhope',
    applicationPayload: {
      projectLocatedDescription: 'BB7, Ribble Valley',
      itemsPlanningToInstall: ['RESERVOIR'],
      reservoirItems: [
        {
          reservoirItemWhatTypeOfReservoir: 'clay',
          reservoirItemHowMuchWater: 62000
        }
      ],
      applicant: {
        business: {
          name: 'Test Bracken Edge Farm',
          address: {
            postalCode: 'ZZ20 1ZZ'
          }
        }
      },
      totalScore: 50,
      scarcityScore: 25,
      sectorScore: 20,
      collaborationScore: 0,
      planningAbstractionScore: 5,
      estimatedMaxGrant: 82800
    }
  }

  it('should have the correct number of columns defined', () => {
    expect(WATER_MANAGEMENT_COLUMNS).toHaveLength(86)
  })

  it('should process a valid water management application event', () => {
    const result = processWaterManagementApplication(eventData)

    expect(result).toHaveLength(WATER_MANAGEMENT_COLUMNS.length)

    // Verify key fields
    expect(result[0]).toBe('wmg-6bd-ct2') // ApplicationId
    expect(result[1]).toBe('2026-11-24T16:40:49.270Z') // ReceiptDate
    expect(result[2]).toBe('800000002') // SBI
    expect(result[3]).toBe('Test Bracken Edge Farm') // BusinessName
    expect(result[4]).toBe('Matilda Test-Stanhope') // ApplicantFullName
    expect(result[5]).toBe('9000000005') // CRN

    // Verify special formatting for projectLocatedDescription (index 13)
    expect(result[13]).toBe('"BB7, Ribble Valley"')

    // Verify item mapping (index 32 for itemsPlanningToInstall)
    expect(result[32]).toBe('RESERVOIR')

    // Verify scores
    expect(result[37]).toBe(50) // totalScore
    expect(result[38]).toBe(20) // sectorScore
    expect(result[39]).toBe(25) // scarcityScore
    expect(result[40]).toBe(0) // collaborationScore
    expect(result[41]).toBe(5) // planningAbstractionScore

    // Verify grant
    expect(result[81]).toBe(82800) // estimatedMaxGrant
  })

  it('should handle missing payload fields gracefully', () => {
    const minimalEvent = {
      applicationId: 'min-123',
      applicationPayload: {}
    }

    const result = processWaterManagementApplication(minimalEvent)
    expect(result[0]).toBe('min-123')
    expect(result[3]).toBe('') // BusinessName
  })

  it('should correctly map reservoir details using handleReservoirDetailColumn', () => {
    const eventWithReservoirs = {
      applicationPayload: {
        reservoirs: [
          {
            name: 'Reservoir A',
            type: 'Concrete',
            size: 50000,
            cost: 100000
          }
        ]
      }
    }

    const result = processWaterManagementApplication(eventWithReservoirs)

    // reservoir1Name is index 42
    expect(result[42]).toBe('Reservoir A')
    // reservoir1Type is index 43
    expect(result[43]).toBe('Concrete')
    // reservoir1Size is index 44
    expect(result[44]).toBe(50000)
    // reservoir1Cost is index 47
    expect(result[47]).toBe(100000)

    // reservoir2Name is index 48, should be empty
    expect(result[48]).toBe('')
  })

  it('should wrap values containing commas in double quotes', () => {
    const eventWithCommas = {
      applicationPayload: {
        reservoir1Name: 'Main, North' // This is tested via handleReservoirDetailColumn
      }
    }
    // Mocking the reservoirs array which is what handleReservoirDetailColumn uses
    eventWithCommas.applicationPayload.reservoirs = [{ name: 'Main, North' }]

    const result = processWaterManagementApplication(eventWithCommas)
    expect(result[42]).toBe('"Main, North"')
  })
})
