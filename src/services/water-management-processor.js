import { valueOrEmptyString, wrapValueWithComma } from '../common/helpers/utils.js'

export const WATER_MANAGEMENT_COLUMNS = [
  'ApplicationId',
  'ReceiptDate',
  'SBI',
  'BusinessName',
  'ApplicantFullName',
  'CRN',
  'businessDetailsUpToDate',
  'yourLegalStatus',
  'companyNumber',
  'charityNumber',
  'sectorsIrrigated',
  'projectLocated__easting',
  'projectLocated__northing',
  'projectLocatedDescription',
  'confirmCorrectLocationSelected',
  'workStartedYet',
  'eligibleOrganisation',
  'organisationType',
  'businessesUsingWater',
  'whereWaterWillComeFrom',
  'havePlanningPermission',
  'planningPermissionReferenceNumber',
  'confirmWillGetPlanningPermission',
  'haveAbstractionLicence',
  'abstractionLicenceConsentNumber',
  'confirmWillGetAbstractionLicence',
  'confirmWantToContinueOnScorePage',
  'confirmConsultedWithTenants',
  'confirmHaveTenancyAgreement',
  'confirmHaveAgreements',
  'expectedProjectStartDate__month',
  'expectedProjectStartDate__year',
  'itemsPlanningToInstall',
  'moreThanOneReservoir',
  'understandNoGuaranteedSuccessOnEstimatedCostPage',
  'acceptTermsAndConditionsOnSubmitApplicationPage',
  'detailsConfirmedAt',
  'locationFound',
  'totalScore',
  'sectorScore',
  'scarcityScore',
  'collaborationScore',
  'planningAbstractionScore',
  'reservoir1Name',
  'reservoir1Type',
  'reservoir1Size',
  'reservoir1HighCostPerUnit',
  'reservoir1LowCostPerUnit',
  'reservoir1Cost',
  'reservoir2Name',
  'reservoir2Type',
  'reservoir2Size',
  'reservoir2HighCostPerUnit',
  'reservoir2LowCostPerUnit',
  'reservoir2Cost',
  'reservoir3Name',
  'reservoir3Type',
  'reservoir3Size',
  'reservoir3HighCostPerUnit',
  'reservoir3LowCostPerUnit',
  'reservoir3Cost',
  'reservoir4Name',
  'reservoir4Type',
  'reservoir4Size',
  'reservoir4HighCostPerUnit',
  'reservoir4LowCostPerUnit',
  'reservoir4Cost',
  'reservoir5Name',
  'reservoir5Type',
  'reservoir5Size',
  'reservoir5HighCostPerUnit',
  'reservoir5LowCostPerUnit',
  'reservoir5Cost',
  'reservoirCost',
  'waterStorageCapacity',
  'waterDistributionLength',
  'distNetworkCostPerUnit',
  'waterDistributionNetworkCost',
  'tanksCostPerUnit',
  'waterTanksCost',
  'totalEstimatedCost',
  'estimatedMaxGrantBeforeReduction',
  'estimatedMaxGrant',
  'minGrantReached',
  'maxGrantReached',
  'guidanceRead',
  'applicationConfirmation',
  'applicant'
]

export const processWaterManagementApplication = (eventData) => {
  const payload = eventData.applicationPayload
  const applicant = payload.applicant || {}
  const business = applicant.business || {}

  return WATER_MANAGEMENT_COLUMNS.map((column) => {
    switch (column) {
      case 'ApplicationId':
        return eventData.applicationId
      case 'ReceiptDate':
        return valueOrEmptyString(eventData.applicationReceiptDate)
      case 'SBI':
        return valueOrEmptyString(eventData.sbi)
      case 'BusinessName':
        return valueOrEmptyString(business.name)
      case 'ApplicantFullName':
        return valueOrEmptyString(eventData.applicantName)
      case 'CRN':
        return valueOrEmptyString(eventData.crn)
      default: {
        const pattern = /^reservoir\d/i

        if (pattern.test(column)) {
          return handleReservoirDetailColumn(payload.reservoirs ?? [], column)
        }
        const value = payload[column]
        if (Array.isArray(value)) {
          return value.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v)).join('|')
        }
        if (typeof value === 'object' && value !== null) {
          return '"' + JSON.stringify(value).replaceAll('"', '""') + '"'
        }
        return wrapValueWithComma(value)
      }
    }
  })
}

function handleReservoirDetailColumn(reservoirsArray, column) {
  const reservoirIndex = parseInt(column.match(/\d+/)[0], 10) - 1
  const reservoir = reservoirsArray[reservoirIndex] || {}

  if (column.endsWith('Cost')) {
    return valueOrEmptyString(reservoir.cost)
  } else if (column.endsWith('HighCostPerUnit')) {
    return valueOrEmptyString(reservoir.reservoirHighCostPerUnit)
  } else if (column.endsWith('LowCostPerUnit')) {
    return valueOrEmptyString(reservoir.reservoirLowCostPerUnit)
  } else if (column.endsWith('Name')) {
    return wrapValueWithComma(reservoir.name)
  } else if (column.endsWith('Type')) {
    return valueOrEmptyString(reservoir.type)
  } else if (column.endsWith('Size')) {
    return valueOrEmptyString(reservoir.size)
  }
  return ''
}
