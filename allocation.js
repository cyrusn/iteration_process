const _ = require('lodash')
const { Parser } = require('json2csv')
const fs = require('fs')
const path = require('path')

module.exports = class Allocation {
  constructor (students, ranks, combinations, subjectPlaces) {
    this.isLog = false
    this.RANKS = ranks
    this.COMBINATIONS = combinations
    this.SUBJECT_PLACES = subjectPlaces
    this.SUBJECT_FILLED = _.mapValues(subjectPlaces, () => [])
    this.STUDENTS = students
    this.IMMUNE_STUDENTS = _.cloneDeep(students)
    this.full = []
    this.failures = []
    this.stages = []
    this.result = []
    this.logFileOption = {
      folder: './log/',
      filename: 'log.csv'
    }
  }

  startLogging = option => {
    Object.assign(this.logFileOption, option)
    this.isLog = true
  }

  updateFull = subj => {
    const { full } = this
    if (_.includes(full)) return
    full.push(subj)
  }

  updateFailures = id => {
    const { failures, removeStudent } = this
    removeStudent(id)
    if (_.includes(failures, id)) return
    failures.push(id)
  }

  // when a combination is assigned to a student, remove the student
  // from student list
  removeStudent = id => {
    const { RANKS, STUDENTS } = this
    // remove student from STUDENTS
    _.remove(STUDENTS, s => s.id === id)

    // remove student from all fields in overall
    _.pull(RANKS.overall, id)

    // remove student from all fields in RANKS
    RANKS.combinations.forEach(rank => _.pull(rank, id))
  }

  // The place is the min of subjects' place in the given combinationId
  get combinationPlaces () {
    const { COMBINATIONS, SUBJECT_PLACES } = this
    return _(COMBINATIONS)
      .map(subjects => {
        return _.min(_.map(subjects, subj => SUBJECT_PLACES[subj]))
      })
      .value()
  }

  /** findPriorityByCombinationId find the preference
  priority of a student with combinationId*/
  findPriorityByCombinationId = (id, combinationId, isRunningStudents) => {
    const { STUDENTS, IMMUNE_STUDENTS, updateFailures } = this
    const searchFrom = isRunningStudents ? STUDENTS : IMMUNE_STUDENTS
    const student = _.find(searchFrom, { id })
    if (student) {
      return student['preferences'].indexOf(combinationId)
    }
    // fail to find student when students are in rank.json but not in student.json
    updateFailures(id)
    return null
  }

  get firstStudentInOverallRanking () {
    const { RANKS } = this
    const id = _.head(RANKS.overall)
    return id
  }

  get zeroPlacesCombinations () {
    const zeroSubjects = []
    const { SUBJECT_PLACES, COMBINATIONS } = this
    _.forIn(SUBJECT_PLACES, (place, subj) => {
      if (place === 0) {
        zeroSubjects.push(subj)
      }
    })
    const zeroPlacesCombinations = []
    COMBINATIONS.forEach((combination, combinationId) => {
      zeroSubjects.forEach(subj => {
        if (_.includes(combination, subj)) {
          zeroPlacesCombinations.push(combinationId)
        }
      })
    })
    return zeroPlacesCombinations
  }

  // retrieve students within the place
  get inCutoffLineStudents () {
    const { COMBINATIONS, combinationPlaces, RANKS } = this
    // combinationId is just the order of the combination in COMBINATIONS
    return _.range(COMBINATIONS.length).map(combinationId => {
      const places = combinationPlaces[combinationId]
      return RANKS.combinations[combinationId].slice(0, places)
    })
  }

  get highestPreferenceInCutoffLineStudents () {
    const { inCutoffLineStudents, findPriorityByCombinationId } = this
    return inCutoffLineStudents.map((studentIds, combinationId) => {
      // using map instead of filter, because need to hold the place for using _.zip
      return studentIds.map(id => {
        const priority = findPriorityByCombinationId(id, combinationId, true)
        if (priority === 0) {
          return id
        }

        return null
      })
    })
  }

  updateStudentsPreference = () => {
    const { STUDENTS, zeroPlacesCombinations } = this
    STUDENTS.forEach(student =>
      _.pull(student.preferences, ...zeroPlacesCombinations)
    )
  }

  get firstStudentWithHighestPreferenceInCutoffLine () {
    const { highestPreferenceInCutoffLineStudents, RANKS } = this

    // using .zip to convert queue in each combination to nth place of all combination
    const zipped = _.zip(...highestPreferenceInCutoffLineStudents)
    const zippedhighestPreferenceInCutoffLineStudents = _(zipped)
      .map(studentIds => _(studentIds).sortBy(id => RANKS.overall.indexOf(id)))
      .value()

    const flattenStudents = []

    _(zippedhighestPreferenceInCutoffLineStudents).forEach(ids => {
      ids.forEach(id => flattenStudents.push(id))
    })

    return _(flattenStudents)
      .compact()
      .head()
  }

  _iterate = () => {
    const {
      SUBJECT_PLACES,
      SUBJECT_FILLED,
      RANKS,
      COMBINATIONS,
      STUDENTS,
      firstStudentInOverallRanking,
      firstStudentWithHighestPreferenceInCutoffLine,
      findPriorityByCombinationId,
      updateFull,
      removeStudent,
      updateStudentsPreference,
      updateFailures
    } = this

    const id =
      firstStudentWithHighestPreferenceInCutoffLine ||
      firstStudentInOverallRanking

    if (!id) {
      // student are not in rank, e.g. no exam / dropped out.
      updateFailures(this.STUDENTS[0].id)
      return
    }

    // update subject place
    const student = _.find(STUDENTS, { id })
    if (!student) {
      updateFailures(id)
      return
    }
    const highestPreference = student.preferences[0]

    // subtract subjects in his / her highestPreference (combination)
    if (highestPreference === undefined) {
      updateFailures(id)
      return
    }

    const combinations = COMBINATIONS[highestPreference]
    const preference = findPriorityByCombinationId(id, highestPreference, false)

    const x1 = combinations[0]
    const x2 = combinations[1]
    const result = {
      id,
      x1,
      x2,
      preference,
      rank: RANKS.overall.indexOf(id),
      x1_order: SUBJECT_FILLED[x1].length + 1,
      x2_order: SUBJECT_FILLED[x2].length + 1,
      places: _.cloneDeep(SUBJECT_PLACES)
    }

    this.result.push(result)

    COMBINATIONS[highestPreference].forEach(subj => {
      SUBJECT_PLACES[subj] -= 1
      SUBJECT_FILLED[subj].push(id)
      if (SUBJECT_PLACES[subj] === 0) {
        updateFull(subj)
      }
    })

    // for either subject in combination is full, remove the combination
    updateStudentsPreference()
    removeStudent(id)
  }

  iterate = () => {
    const {
      isLog,
      IMMUNE_STUDENTS,
      _iterate,
      updateStages,
      logFileOption: { folder, filename }
    } = this

    const filePath = path.resolve(folder, filename)
    if (isLog) {
      fs.rmSync(folder, { recursive: true, force: true })
      fs.mkdirSync(folder)
      fs.writeFileSync(filePath, '')
    }

    _.range(IMMUNE_STUDENTS.length).forEach(n => {
      if (isLog) updateStages(n)
      _iterate()
    })
  }

  updateStages = n => {
    const {
      RANKS,
      COMBINATIONS,
      combinationPlaces,
      findPriorityByCombinationId
    } = this

    // rank the students with priority in all combinations.
    const combinationWithPriority = _(RANKS.combinations)
      .map((ids, combinationId) => {
        return _(ids)
          .map(id => {
            const preference = findPriorityByCombinationId(
              id,
              combinationId,
              true
            )
            if (preference === -1) return null
            return `(${preference}) ${id}`
          })
          .compact()
          .value()
      })
      .value()

    const combinationRanks = _.zipObject(
      COMBINATIONS.map(s => s.join('-')),
      combinationWithPriority
    )

    const overall = _.cloneDeep(RANKS.overall)

    const logPlaces = _.zipObject(
      COMBINATIONS.map(arr => arr.join('-')),
      combinationPlaces
    )

    const stage = Object.assign(
      {},
      { overall },
      _.omitBy(combinationRanks, obj => obj.length === 0)
    )

    if (_.isEmpty(stage.overall)) return

    try {
      const {
        logFileOption: { folder, filename }
      } = this

      const parser = new Parser()
      const csv = parser.parse(transform(stage))
      const csvAppend = parser.parse(logPlaces)

      const filePath = path.resolve(folder, filename)

      fs.appendFileSync(filePath, csvAppend + '\n')
      fs.appendFileSync(filePath, csv.slice(csv.indexOf('\n') + 1) + '\n')
      fs.appendFileSync(filePath, '\n')
      fs.appendFileSync(filePath, '\n')
    } catch (e) {
      console.log(e)
    }
  }
}

/** transform object to array for json2csv parsing. format as below.
const example = {
  a: [1, 2, 3, 4, 9],
  b: [5, 6, 7, 8],
  c: [1]
}
const result = [
  { a: 1, b: 5, c: 1 },
  { a: 2, b: 6 },
  { a: 3, b: 7 },
  { a: 5, b: 8 },
  { a: 9 }
]
*/
function transform (obj) {
  const result = []
  _.forIn(obj, (val, key) => {
    _.each(val, (n, i) => {
      ;(result[i] || (result[i] = []))[key] = n
    })
  })
  return result
}
