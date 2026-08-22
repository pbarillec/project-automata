export const ROBOTS_BUILT_PER_ROBOT_LINE_LEVEL_PER_SECOND = 0.005;
export const ROBOTS_BUILT_RELATIVE_TOLERANCE = 32 * Number.EPSILON;
export const ROBOTS_BUILT_ABSOLUTE_TOLERANCE = 1e-12;
export const ROBOTS_BUILT_THRESHOLDS = Object.freeze([1, 10, 100, 1000]);

export class RobotsBuiltInputError extends RangeError {
    constructor(message: string) {
        super(message);
        this.name = 'RobotsBuiltInputError';
    }
}

export function calculateRobotsBuiltPerSecond(robotLineLevel: number): number {
    validateRobotLineLevel(robotLineLevel);

    const rate = ROBOTS_BUILT_PER_ROBOT_LINE_LEVEL_PER_SECOND * robotLineLevel;
    assertFiniteRobotsBuilt(rate, 'robotsBuiltPerSecond');
    return rate;
}

export function calculateRobotsBuiltForElapsedSeconds(robotsBuiltPerSecond: number, elapsedSeconds: number): number {
    validateRobotsBuiltPerSecond(robotsBuiltPerSecond);
    validateElapsedSeconds(elapsedSeconds);

    const robotsBuilt = robotsBuiltPerSecond * elapsedSeconds;
    assertFiniteRobotsBuilt(robotsBuilt, 'elapsed Robots Built');
    return robotsBuilt;
}

export function calculateRobotsBuiltFromRobotLineElapsedSeconds(
    robotLineLevel: number,
    elapsedSeconds: number,
): number {
    return calculateRobotsBuiltForElapsedSeconds(
        calculateRobotsBuiltPerSecond(robotLineLevel),
        elapsedSeconds,
    );
}

export function resolveCrossedRobotsBuiltThresholds(
    previousRobotsBuilt: number,
    newRobotsBuilt: number,
): readonly number[] {
    validateRobotsBuiltTotal(previousRobotsBuilt, 'previousRobotsBuilt');
    validateRobotsBuiltTotal(newRobotsBuilt, 'newRobotsBuilt');

    if (newRobotsBuilt < previousRobotsBuilt) {
        throw new RobotsBuiltInputError('newRobotsBuilt must be greater than or equal to previousRobotsBuilt.');
    }

    return ROBOTS_BUILT_THRESHOLDS.filter((threshold) => (
        previousRobotsBuilt < threshold && newRobotsBuilt >= threshold
    ));
}

export function isRobotsBuiltApproximatelyEqual(left: number, right: number): boolean {
    validateRobotsBuiltTotal(left, 'left Robots Built value');
    validateRobotsBuiltTotal(right, 'right Robots Built value');
    return Math.abs(left - right) <= robotsBuiltTolerance(left, right);
}

function validateRobotLineLevel(robotLineLevel: number): void {
    if (!Number.isSafeInteger(robotLineLevel) || robotLineLevel < 0) {
        throw new RobotsBuiltInputError('robotLineLevel must be a non-negative safe integer.');
    }
}

function validateRobotsBuiltPerSecond(robotsBuiltPerSecond: number): void {
    if (!Number.isFinite(robotsBuiltPerSecond) || robotsBuiltPerSecond < 0) {
        throw new RobotsBuiltInputError('robotsBuiltPerSecond must be a non-negative finite number.');
    }
}

function validateElapsedSeconds(elapsedSeconds: number): void {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
        throw new RobotsBuiltInputError('elapsedSeconds must be a non-negative finite number.');
    }
}

function validateRobotsBuiltTotal(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RobotsBuiltInputError(`${label} must be a non-negative finite number.`);
    }
}

function assertFiniteRobotsBuilt(value: number, label: string): void {
    if (!Number.isFinite(value)) {
        throw new RobotsBuiltInputError(`${label} exceeds JavaScript Number range.`);
    }
}

function robotsBuiltTolerance(left: number, right: number): number {
    return Math.max(
        ROBOTS_BUILT_ABSOLUTE_TOLERANCE,
        ROBOTS_BUILT_RELATIVE_TOLERANCE * Math.max(1, Math.abs(left), Math.abs(right)),
    );
}
